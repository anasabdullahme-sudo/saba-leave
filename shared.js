/* ==========================================================================
   سابا — بوابة رفع الإجازات (ملف مشترك بين صفحة المريض ولوحة الموظف)
   --------------------------------------------------------------------------
   1) عبّ firebaseConfig من: Firebase Console › Project settings › Your apps
   2) عبّ RECAPTCHA_SITE_KEY من: google.com/recaptcha/admin (نوع v3) وسجّله في Firebase › App Check
   إذا تركت apiKey فاضي → الموقع يشتغل "وضع تجريبي" على جهازك فقط (للمعاينة).
   ========================================================================== */

export const firebaseConfig = {
  apiKey: "AIzaSyCjfyElLq4gBcUu9H7O590yPDkDt8UPqwc",
  authDomain: "saba-leave.firebaseapp.com",
  projectId: "saba-leave",
  storageBucket: "saba-leave.firebasestorage.app",
  messagingSenderId: "371968010939",
  appId: "1:371968010939:web:987e7a3e10debb9409979e"
};
export const RECAPTCHA_SITE_KEY = "6Lc9f-8tAAAAAPM5ed7dEHEiRDcFezL0jXDkI9gc";        // مفتاح reCAPTCHA (مطلوب للذكاء الاصطناعي)
export const RECAPTCHA_PROVIDER = "enterprise";      // "v3" مجاني بدون فوترة | "enterprise" بعد تفعيل Blaze
export const IMAGE_STORE = "firestore";      // "firestore" يشتغل على الخطة المجانية | "storage" بعد تفعيل Blaze
export const AI_ENABLED = true;              // القراءة بالذكاء من الصورة
export const AI_MODEL = "gemini-3.5-flash-lite";   // الأسرع (Ultra fast)
// احتياط: لو الأول تأخر أكثر من AI_HEDGE_MS أو كان مزحوم، يبدأ الثاني بالتوازي وناخذ أول نتيجة
export const AI_FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
export const AI_HEDGE_MS = 6000;  // نسخة مستقرة حتى مايو 2027 على الأقل
export const FB_VERSION = "13.0.0";
export const SEHA_URL = "https://www.seha.sa/";   // الصفحة الرئيسية (مو صفحة الدخول — فتحها وأنت داخل كان يطلّع الموظف)

export const DEMO = !firebaseConfig.apiKey;
// الوضع التجريبي مسموح فقط على جهازك أو داخل Claude — على الموقع الحقيقي بدون إعدادات يتوقف بدل ما يحفظ في المتصفح
const LOCAL_HOST = location.protocol === "file:" || ["localhost", "127.0.0.1", "", "[::1]"].includes(location.hostname);

/* ---------- الفروع ---------- */
export const BRANCHES = [
  { id: "haramain",     ar: "الحرمين" },
  { id: "sulaimaniyah", ar: "السليمانية" },
  { id: "tala",         ar: "تالا" },
  { id: "bawadi",       ar: "سابا البوادي" },
  { id: "watanak",      ar: "وطنك" },
];
export const DEFAULT_BRANCH = "bawadi";

/* ---------- حساب منصة صحة لكل فرع (من صفحة "حسابات صحة طبي") ---------- */
export const SEHA_ACCOUNTS = {
  bawadi:   { group: "سابا الطبية",                  role: "مدخل الإجازات المرضية", key: "البوادي" },
  tala:     { group: "مجمع عيادات تالة الجبل الطبية", role: "مدخل الإجازات المرضية", key: "تالة" },
  watanak:  { group: "مجمع عيادات وطنك",             role: "مدخل الإجازات المرضية", key: "وطنك" },
  haramain: { group: "شركة سابا المتطورة المحدودة",  role: "مدخل الإجازات المرضية", key: "الحرمين" },
  sulaimaniyah: { group: "سابا الطبية",                role: "مدخل الإجازات المرضية", key: "السليمانية" },
}; // أي طبيب غير مذكور → ترخيصه على البوادي
export const branchName = id => (BRANCHES.find(b => b.id === id) || {}).ar || id;

/* ---------- أنواع الطلبات ---------- */
export const TYPES = [
  { id: "sick",       ar: "إجازة مرضية",       short: "إجازة مرضية" },
  { id: "companion",  ar: "إجازة مرضية مرافق", short: "إجازة مرافق" },
  { id: "attendance", ar: "مشهد حضور",         short: "مشهد حضور" },
];
export const typeName = id => (TYPES.find(t => t.id === id) || {}).ar || id;

/* ---------- أسباب التعليق ---------- */
export const HOLD_REASONS = [
  { id: "license", ar: "ترخيص الطبيب" },
  { id: "data",    ar: "خطأ في البيانات" },
  { id: "other",   ar: "أخرى" },
];
export const holdName = id => (HOLD_REASONS.find(r => r.id === id) || {}).ar || id || "";

/* ---------- الأطباء المرخّصين في فروع أخرى (عربي + إنجليزي + صيغ بديلة) ---------- */
export const DOCTORS = [
  // عيادات تالا الجبل
  { id: "rasha-waziri",     branch: "tala", ar: "رشا الوزيري",     en: "Rasha Al-Waziri",     alt: ["Rasha Elwaziry", "Rasha Waziry"] },
  { id: "nashwa-saqqa",     branch: "tala", ar: "نشوى السقا",      en: "Nashwa Al-Saqqa",     alt: ["نشوى عبدالكافي السقا", "Nashwa Sakka", "Nachwa Sakka", "Nashwa Elsakka"] },
  { id: "ahmed-kashaf",     branch: "tala", ar: "أحمد كشاف",       en: "Ahmed Kashaf",        alt: ["Ahmad Kashaf", "Ahmed Kashef"] },
  { id: "walaa-mansour",    branch: "tala", ar: "ولاء منصور",      en: "Walaa Mansour",       alt: ["Wala Mansour", "Walaa Mansor"] },
  { id: "manal-dowidar",    branch: "tala", ar: "منال دويدار",     en: "Manal Dowidar",       alt: ["Manal Dewidar", "Manal Doweidar"] },
  { id: "khaled-allam",     branch: "tala", ar: "خالد علام",       en: "Khaled Allam",        alt: ["Khalid Allam", "Khaled Alam"] },
  { id: "rami-kilany",      branch: "tala", ar: "رامي الكيلاني",   en: "Rami El-Kilany",      alt: ["Ramy Elkilany", "Rami Al-Kilani", "Ramy Kilany"] },
  { id: "hussein-hamid",    branch: "tala", ar: "حسين عبدالحميد",  en: "Hussein Abdelhamid",  alt: ["Hussein Abdel Hamid", "Hussain Abdulhameed", "Hosein Abdelhamid"] },
  { id: "wejdan-bajubaa",   branch: "tala", ar: "وجدان باجبع",     en: "Wejdan Bajubaa",      alt: ["Wijdan Bajabaa", "Wejdan Bajaba"] },
  // عيادات وطنك
  { id: "wafaa-mohamed",    branch: "watanak", ar: "وفاء محمد",    en: "Wafaa Mohamed",       alt: ["Wafa Mohammed", "Wafaa Muhammad"] },
  { id: "elham-shaheen",    branch: "watanak", ar: "إلهام شاهين",  en: "Elham Shaheen",       alt: ["Ilham Shahin", "Elham Shahin"] },
  // سابا البوادي (أي طبيب غير مذكور يروح للبوادي تلقائياً — هنا بس عشان يتعرّف على الاسم العربي)
  { id: "ikramy-sharkawy",  branch: "bawadi", ar: "إكرامي الشرقاوي", en: "Ekramy Elsharkawy",   alt: ["اكرامي الشرقاوي", "إكرامي عبدالسلام الشرقاوي", "Ikramy Elsharkawy", "Ekramy El-Sharkawy", "Ekramy Abdelsalam Elsharkawy", "Abdelsalam Al sharqawy"] },
  { id: "hussam-hameed",    branch: "bawadi", ar: "حسام الدين حميد", en: "Hussam Alden Hameed", alt: ["حسام الدين محمد", "حسام حميد", "Hussam Aldin Hameed", "Hussam Aldin Mohammed", "Hussam Eldin Hamid", "Hossam Eldin Hamid", "Hossam Aldin Mohamed"] },
  { id: "mohamed-wali",     branch: "bawadi", ar: "محمد والي",     en: "Mohamed Wali",        alt: ["محمد والى", "Mohammed Wali", "Mohamed Waly", "Mohamed Wally", "Mohammad Wali"] },
  // سابا الحرمين
  { id: "alyaa-wara",       branch: "haramain", ar: "علياء الورع",    en: "Alyaa Al-Wara",       alt: ["Alia Alwaraa", "Aliaa Elwara", "علياء الوريث", "Aliya Alwareeth", "Alyaa Alwareeth"] },
  { id: "ehab-metwally",    branch: "haramain", ar: "إيهاب المتولي",  en: "Ehab El-Metwally",    alt: ["Ihab Metwally", "Ehab Elmetwaly", "Ehab Al-Mutawalli"] },
  { id: "fatma-ibrahim",    branch: "haramain", ar: "فاطمة إبراهيم",  en: "Fatma Ibrahim",       alt: ["فاطمة ابراهيم محمد ابراهيم", "فاطمة ابراهيم ابراهيم", "د.فاطمة ابراهيم", "Fatima Ebrahim Ebrahim", "Dr.Fatima Ebrahim", "فاطمه ابراهيم", "Fatima Ibrahim", "Fatma Ibrahim Mohamed", "Fatma Ebrahim", "Fatima Ibraheem"] },
  { id: "fatma-ibrahim",     branch: "haramain", ar: "فاطمة إبراهيم",   en: "Fatma Ibrahim",       alt: ["فاطمة ابراهيم محمد ابراهيم", "فاطمه ابراهيم", "Fatma Ibrahim Mohamed Ibrahim", "Fatima Ibrahim", "Fatmah Ibraheem", "Fatma Ebrahim", "Fatima Mohamed Ibrahim"] },
  { id: "sahar-mohamed",    branch: "haramain", ar: "سحر محمد",        en: "Sahar Mohamed",       alt: ["Sahar Mohammed", "Sahar Muhammad"] },
  { id: "sara-shoreiji",     branch: "haramain", ar: "سارة الجارحي",    en: "Sara Fouad Elgarhi",  alt: ["سارة فؤاد الجارحي", "ساره فؤاد الجارحي", "سارة فؤاد", "Sara Elgarhi", "Sarah Elgarhi", "Sara El-Garhy", "Sara Elgarhy", "Sarah Fouad Elgarhy"] },
];
export const doctorById = id => DOCTORS.find(d => d.id === id);

/* ---------- طلبات التعديل ---------- */
// الخانات اللي يقدر الموظف يطلب من المريض يعدّلها
export const FIX_FIELDS = [
  { k: "patientName", ar: "الاسم" },
  { k: "idNumber", ar: "رقم الهوية/الإقامة" },
  { k: "dob", ar: "تاريخ الميلاد" },
  { k: "phone", ar: "رقم الجوال" },
  { k: "leaveStart", ar: "تاريخ بداية الإجازة", types: ["sick", "companion"] },
  { k: "leaveEnd", ar: "تاريخ نهاية الإجازة", types: ["sick", "companion"] },
  { k: "visitDate", ar: "تاريخ الحضور", types: ["attendance"] },
  { k: "companionName", ar: "اسم المرافق", types: ["companion"] },
  { k: "companionId", ar: "هوية المرافق", types: ["companion"] },
  { k: "companionDob", ar: "تاريخ ميلاد المرافق", types: ["companion"] },
  { k: "relationship", ar: "صلة القرابة", types: ["companion"] },
  { k: "photo", ar: "صورة التقرير" },
];
export const fixFieldsFor = type => FIX_FIELDS.filter(f => !f.types || f.types.includes(type));
/** لما الموظف يغيّر نوع الطلب (مثلاً مرضية ← مرافق): الخانات اللي لازم المريض يكمّلها للنوع الجديد */
export function typeSwitchFields(from, to) {
  if (!to || to === from) return [];
  if (to === "companion") return ["companionName", "companionId", "companionDob", "relationship"];
  if (to === "attendance") return ["visitDate"];
  if (to === "sick" && from === "attendance") return ["leaveStart", "leaveEnd"];
  return [];
}
export const fixLabel = k => (FIX_FIELDS.find(f => f.k === k) || {}).ar || k;
export const fixLink = id => new URL(`./?fix=${id}`, location.href).href;
export function fixMessage({ name, ref, type, newType, fields, note, link }) {
  const TN = { sick: "إجازة مرضية", companion: "إجازة مرافق", attendance: "مشهد حضور" };
  const t = TN[type] || "الإجازة", changed = newType && newType !== type;
  return [
    `السلام عليكم${name ? " " + name.split(" ")[0] : ""} 🌷`,
    `معك عيادات سابا بخصوص طلب رفع ${t}${ref ? " رقم " + ref : ""}.`,
    changed ? `طلبك لازم يكون «${TN[newType]}» بدل «${t}»، ونحتاج تكمّل البيانات الناقصة.` : "",
    `نحتاج تصحيح: ${fields.map(fixLabel).join("، ")}`,
    note ? `ملاحظة: ${note}` : "",
    "",
    "عدّل بياناتك من الرابط، ونكمل رفع طلبك على طول:",
    link,
  ].filter((l, i, arr) => l || i === arr.length - 3).join("\n");
}

/* ---------- تطبيع الأسماء + مطابقة الطبيب ---------- */
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩", FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export function latinDigits(s = "") {
  return String(s).replace(/[٠-٩]/g, c => AR_DIGITS.indexOf(c)).replace(/[۰-۹]/g, c => FA_DIGITS.indexOf(c));
}
export function normName(s = "") {
  return latinDigits(s).toLowerCase()
    .replace(/[ً-ْـ]/g, "")            // تشكيل وتطويل
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/\b(dr|doctor|prof|consultant|specialist)\b\.?/g, " ")
    .replace(/(^|\s)(د|دكتور|دكتوره|الدكتور|الدكتوره|استشاري|استشاريه|اخصائي|اخصائيه)(\.|\s|$)/g, " ")
    .replace(/[^a-zء-ي\s-]/g, " ")
    .replace(/(^|\s)(al|el)[- ]/g, " ")
    .replace(/(^|\s)ال/g, " ")
    .replace(/-/g, " ").replace(/\s+/g, " ").trim();
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i-1][j] + 1, m[i][j-1] + 1, m[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return m[a.length][b.length];
}
const tokEq = (x, y) => x === y || (x.length > 3 && y.length > 3 && lev(x, y) <= 1) || (x.length > 5 && y.length > 5 && lev(x, y) <= 2);

/** يرجّع { doctor, branch } — الطبيب null إذا ما انعرف (الفرع = البوادي) */
export function matchDoctor(input) {
  const toks = normName(input).split(" ").filter(Boolean);
  if (!toks.length) return { doctor: null, branch: DEFAULT_BRANCH };
  let best = null, bestScore = 0;
  for (const d of DOCTORS) {
    for (const v of [d.ar, d.en, ...(d.alt || [])]) {
      const dt = normName(v).split(" ").filter(Boolean);
      const first = toks.some(t => tokEq(t, dt[0]));
      const rest = dt.slice(1).filter(x => toks.some(t => tokEq(t, x))).length;
      let score = (first ? 2 : 0) + rest * 1.5;
      if (first && rest) score += 2;
      if (score > bestScore) { bestScore = score; best = d; }
    }
  }
  if (best && bestScore >= 4) return { doctor: best, branch: best.branch };
  // اسم أول فقط: يُقبل إذا كان فريد بين الأطباء
  if (best && bestScore >= 2 && toks.length === 1) {
    const sameFirst = DOCTORS.filter(d => [d.ar, d.en].some(v => tokEq(normName(v).split(" ")[0], toks[0])));
    if (sameFirst.length === 1) return { doctor: best, branch: best.branch };
  }
  return { doctor: null, branch: DEFAULT_BRANCH };
}

/** هل الطبيب (من رقم تعرّف الذكاء أو المحفوظ) يتوافق مع الأسماء المكتوبة فعلاً؟ يمنع «حسام» يصير «حسين» */
export function doctorFits(doc, ...names) {
  const ns = names.map(n => String(n || "")).filter(n => normName(n));
  if (!doc || !ns.length) return true;                       // ما فيه اسم مكتوب نقارن فيه
  if (ns.some(n => matchDoctor(n).doctor?.id === doc.id)) return true;
  const toks = ns.flatMap(n => normName(n).split(" ")).filter(t => t.length > 1);
  return [doc.ar, doc.en, ...(doc.alt || [])].some(v => {
    const f = normName(v).split(" ")[0];
    return toks.some(t => t === f || (t.length > 3 && f.length > 3 && lev(t, f) <= 1));
  });
}

/* ---------- أدوات عامة ---------- */
export function fmtDateInput(v) {             // يحوّل أي إدخال إلى dd/mm/yyyy أثناء الكتابة
  const d = latinDigits(v).replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return d.slice(0, 2) + "/" + d.slice(2);
  return d.slice(0, 2) + "/" + d.slice(2, 4) + "/" + d.slice(4);
}
export function isoToDmy(iso = "") {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(latinDigits(iso));
  return m ? `${m[3].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[1]}` : (iso || "");
}
export function addDaysDmy(dmy, n) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy || ""); if (!m || !(n > 0)) return "";
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1] + n - 1));
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}
/** كتابة يدوية + اختيار من التقويم لنفس الخانة (dd/mm/yyyy) */
const CAL_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2"/></svg>';
export function attachDatePicker(inp) {
  if (!inp || inp.dataset.dp) return; inp.dataset.dp = "1";
  const doc = inp.ownerDocument, W = doc.defaultView;
  const wrap = doc.createElement("span"); wrap.className = "dp"; wrap.innerHTML = CAL_SVG;
  const nat = doc.createElement("input"); nat.type = "date"; nat.className = "dp-native"; nat.tabIndex = -1;
  nat.setAttribute("aria-label", "اختر من التقويم"); nat.min = "1900-01-01"; nat.max = "2100-12-31";
  wrap.append(nat);
  const sync = () => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(inp.value || ""); nat.value = m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };
  nat.addEventListener("click", () => { try { nat.showPicker?.(); } catch {} });
  nat.addEventListener("change", () => {
    if (!nat.value) return;
    inp.value = isoToDmy(nat.value);
    inp.dispatchEvent(new W.Event("input", { bubbles: true }));
    inp.dispatchEvent(new W.Event("change", { bubbles: true }));
  });
  inp.addEventListener("input", sync); inp.addEventListener("focus", sync); sync();
  inp.insertAdjacentElement("afterend", wrap);
}
export function validDmy(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || "");
  if (!m) return false;
  const [d, mo, y] = [+m[1], +m[2], +m[3]];
  return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1300 && y <= 2100;
}
export const dmyKey = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || ""); return m ? +(m[3] + m[2] + m[1]) : 0; };
export function normPhone(s = "") {
  let p = latinDigits(s).replace(/\D/g, "");
  if (p.startsWith("00966")) p = p.slice(5);
  if (p.startsWith("966")) p = p.slice(3);
  if (p.length === 9 && p.startsWith("5")) p = "0" + p;
  return p;
}
export const validPhone = p => /^05\d{8}$/.test(normPhone(p));
export const validId = s => /^[12]\d{9}$/.test(latinDigits(s).replace(/\D/g, ""));
/* ---------- كشف الطلب المكرر تماماً (نفس النوع والهوية والميلاد وتواريخ الإجازة) ---------- */
export const dupFields = r => [r.type, latinDigits(r.idNumber || ""), r.dob || "", r.leaveStart || "", r.leaveEnd || "", r.visitDate || "", latinDigits(r.companionId || "")].join("|");
export async function dupKey(r) {
  try {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("saba-dup|" + dupFields(r)));
    return [...new Uint8Array(h)].slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch { return ""; }
}
/* ---------- «تابع طلبك»: بصمة (الهوية + الجوال) — نفس اللي يحسبها البوت ---------- */
export async function trackKey(id, phone) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`saba-track|${latinDigits(id || "").replace(/\D/g, "")}|${normPhone(phone || "")}`));
  return [...new Uint8Array(h)].slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("");
}
/* ---------- رقم الجهاز (الموظفين يدخلون بنفس الحساب: أنس ١، أنس ٢…) ---------- */
export async function devKey(n) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("saba-dev|" + n));
  return [...new Uint8Array(h)].slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("");
}
export const arNum = n => String(n).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
/** عنوان الورقة فوق لازم يكون إجازة مرضية (أو مشهد) — غير كذا (وصفة، تحليل…) ما ينقبل */
export const leaveTitleOk = t => !String(t || "").trim() || /sick\s*leave|leave\s*report|medical\s*leave|attendance|visit|حضور|إجاز[ةه]\s*مرضي|اجاز[ةه]\s*مرضي|بإجاز[ةه]|باجاز[ةه]|مشهد|مرافق|companion/i.test(String(t));
export const makeRef = () => {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "SB-" + Array.from(crypto.getRandomValues(new Uint8Array(5)), x => a[x % a.length]).join("");
};
export function timeAgo(ms) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "الآن";
  const m = Math.round(s / 60); if (m < 60) return `قبل ${m} د`;
  const h = Math.round(m / 60); if (h < 24) return `قبل ${h} س`;
  return `قبل ${Math.round(h / 24)} يوم`;
}

/** ضغط الصورة قبل الرفع (أسرع رفع + أسرع قراءة) */
export async function compressImage(file, maxSide = 1800, quality = 0.85) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", quality));
    return blob || file;
  } catch { return file; }
}
export const blobToBase64 = b => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(b);
});
const blobToDataURL = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });

/* ==========================================================================
   تعليمات القراءة الذكية
   ========================================================================== */
function aiPrompt(type) {
  const list = DOCTORS.map(d => `- id="${d.id}" | ${d.ar} | ${d.en}${d.alt?.length ? " | " + d.alt.join(" / ") : ""}`).join("\n");
  return `You read phone photos of Saba Clinics (سابا) printed reports. Photos may be tilted, curled, folded, shadowed, partly cropped, or upside down.
The patient chose request type: ${type} (${typeName(type)}).

THE USUAL TEMPLATE ("Sick Leave Report / تقرير بإجازة مرضية", printed by Athir HIS):
Top-right block, English label on the left, value in the middle, Arabic label on the right:
  Patient ID / رقم الملف الطبي  → a 7-digit clinic FILE number. This is NOT the national ID. Put it ONLY in patient_file_no.
  National ID / رقم الهوية الوطنية → 10 digits starting with 1 (Saudi) or 2 (Iqama). Put it in id_number.
  Name / الاسم → English name in CAPITALS, with the Arabic name printed in small text right under it.
  Nationality, Age ("33 Y - 6 M - 28 D", ignore), Date of Birth (YYYY-MM-DD), Gender.
Middle block:
  "Sick Leave for ( N ) one day / منحه إجازة مرضية لمدة ( N ) يوم" → leave_days = N
  "Starting from DD-MM-YYYY / اعتباراً من" → leave_start (note: DAY-MONTH-YEAR here, unlike Date of Birth)
  "Mobile number / رقم الجوال" → 12 digits like 9665XXXXXXXX
  "Accompanied By / برفقة" → usually empty; if filled it is the companion's name.
  "reason / السبب" → diagnosis text (English or Arabic).
Bottom: "Physician Name / اسم الطبيب" printed in English (left) and Arabic (right).
A blue/purple rubber STAMP (ختم) usually sits below it with the signing doctor's name, e.g. "Dr. Sarah El-Shourbagy / د. سارة الشوربجي".
The stamped doctor CAN DIFFER from the printed Physician Name — read both separately.
Ignore: Tax Number (300105513910003), branch address footer, clinic name "SABA CLINICS AL BAWADI".

OUTPUT RULES:
- "" for anything not clearly readable. Never invent or guess digits. Convert Arabic-Indic digits to 0-9.
- All dates as Gregorian YYYY-MM-DD. If only Hijri is shown, convert and put the original in *_raw.
- leave_end = leave_start + leave_days − 1 (if a separate end date is printed, use it).
- patient_name_en: the English (capitals) name. patient_name_ar: the Arabic name. patient_name: Arabic if present, else English.
- mobile: digits only as printed.
- doctor_name: printed Physician Name (English as printed; include the Arabic too, e.g. "Sara Fouad Elgarhi / ساره فؤاد الجارحي").
- stamp_doctor_name: the name on the stamp, or "" if no stamp/unreadable.
- doctor_id: match the printed physician to the list below (any spelling, ignore titles like Dr./د./استشاري). stamp_doctor_id: same for the stamp. Use "" when no clear match — a shared first name alone is NOT a match.
${list}
- doc_title: the main title printed at the top of the document, exactly as written (Arabic and/or English), e.g. "Sick Leave Report / تقرير بإجازة مرضية" or "Drug Prescription / وصفة طبية".
- document_kind: "sick_leave" for a sick leave report with "Accompanied By" empty, "companion_leave" if it is a companion leave or "Accompanied By" is filled, "attendance" for an attendance/visit certificate (مشهد حضور/مراجعة), "other" otherwise — IMPORTANT: a drug prescription (Drug Prescription / وصفة طبية / وصفة علاجية, a list of medicines with dosage), lab or radiology results, an invoice/receipt, an appointment card, a referral, or any medical report that does NOT grant leave days is "other", even if it shows the patient and doctor details.
- For companion leave: companion_name / companion_id / companion_dob belong to the companion; patient_* to the sick patient.
- For attendance: visit_date = the visit date.
- quality: "good", "blurry" (text hard to read), "cropped" (key fields cut off), or "not_document".`;
}

/* ==========================================================================
   الواجهة الخلفية (Firebase حقيقي أو وضع تجريبي)
   ========================================================================== */
let _api;
export function backend(role /* 'patient' | 'staff' */) {
  return _api ||= (async () => {
    if (!DEMO) return liveBackend(role);
    if (!LOCAL_HOST && !window.claude?.use) { blockPage(); return new Promise(() => {}); }
    if (window.claude?.use) { const a = await artifactBackend().catch(e => (console.warn(e), null)); if (a) return a; }
    return demoBackend();
  })();
}

function blockPage() {
  const d = document.createElement("div");
  d.setAttribute("role", "alert");
  d.style.cssText = "position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:#F3FAFE;font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;direction:rtl;padding:24px;text-align:center;color:#003765";
  d.innerHTML = '<div style="max-width:420px"><h1 style="font-size:24px;margin:0 0 10px">الموقع غير مربوط بقاعدة البيانات</h1><p style="color:#5B7690;line-height:1.8;margin:0">إعدادات Firebase ناقصة في ملف shared.js، فتم إيقاف الموقع حتى لا تضيع أي بيانات. تواصل مع مسؤول النظام.</p></div>';
  (document.body || document.documentElement).append(d);
}

/* ------------- نسخة التجربة داخل Claude (قاعدة بيانات + قراءة بـ Claude) ------------- */
const AI_KEYS = ["patient_name","patient_name_ar","patient_name_en","patient_file_no","id_number","nationality","gender","dob","dob_raw","mobile",
  "leave_start","leave_start_raw","leave_days","leave_end","visit_date","reason","accompanied_by",
  "doctor_name","doctor_id","stamp_doctor_name","stamp_doctor_id","companion_name","companion_id","companion_dob","relationship","doc_title"];
async function artifactBackend() {
  const [db, sample, assets, user] = await Promise.all(["db", "sample", "assets", "user"].map(n => window.claude.use(n).catch(() => null)));
  if (!db) return null;
  const col = db.collection("requests");
  const toObj = d => ({ id: d.id, ...d.data() });
  const own = b => b.arrayBuffer().then(buf => new Blob([buf], { type: b.type || "image/jpeg" })); // نسخة من نفس الصفحة
  async function topCrop(blob) {
    try {
      const bmp = await createImageBitmap(blob); const h = Math.round(bmp.height * 0.62);
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = h;
      c.getContext("2d").drawImage(bmp, 0, 0, bmp.width, h, 0, 0, bmp.width, h);
      return await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
    } catch { return null; }
  }
  let me = null;
  const everSeen = new Set();
  const api = {
    demo: false, trial: true, extractTimeout: 120000,
    ensureAnon: async () => "trial",
    warmup: async () => {},
    async extract(blob, type) {
      if (!sample) throw new Error("sample unavailable");
      const lim = await sample.limits().catch(() => null);
      if (!lim?.images) throw new Error("images unavailable");
      const full = await own(blob);
      const imgs = [full];
      if ((lim.images.maxCount || 1) > 1) { const c = await topCrop(full); if (c) imgs.push(c); }
      const prompt = aiPrompt(type) + `

${imgs.length > 1 ? "Image 1 is the whole page. Image 2 is a zoomed crop of the TOP part of the same page (sharper digits) — use it to read the numbers and names accurately.\n" : ""}Reply with ONLY one JSON object with exactly these keys, every value a string ("" when unknown):
${AI_KEYS.join(", ")}, document_kind, quality.`;
      const r = await sample.json(prompt, { images: imgs, modelTier: "quick", cache: false });
      const out = {}; for (const k of [...AI_KEYS, "document_kind", "quality"]) out[k] = r && r[k] != null ? String(r[k]) : "";
      return out;
    },
    async uploadImage(blob, onProgress) {
      onProgress?.(0.15);
      const b = await own(blob);
      if (assets) {
        try { const r = await assets.upload(b, { type: b.type === "application/pdf" ? "application/pdf" : "image/jpeg" }); onProgress?.(1); return "/_blob/" + r.id; }
        catch (e) { console.warn("assets", e); }
      }
      const small = b.type === "application/pdf" ? b : await compressImage(b, 1000, 0.62);
      onProgress?.(1); return await blobToDataURL(small);
    },
    async createRequest(data) {
      const ref = col.doc();
      await ref.set({ ...data, status: "pending", createdAt: Date.now(), doneAt: null, doneBy: null });
      return ref.id;
    },
    onAuth(cb) {
      (async () => {
        let name = "";
        try { name = (await user?.me())?.name || ""; } catch {}
        me = { uid: "trial", email: "", name: name || "الموظف" }; cb(me);
      })();
      return () => {};
    },
    login: async () => {}, logout: async () => {},
    watchPending(cb, onErr) {
      let first = true;
      return col.where("status", "in", ["pending", "held"]).onSnapshot(s => {
        const list = s.docs.map(toObj).sort((a, b) => a.createdAt - b.createdAt);
        const added = first ? [] : list.filter(x => !everSeen.has(x.id)).map(x => x.id);
        list.forEach(x => everSeen.add(x.id)); first = false;
        cb(list, added);
      }, e => onErr?.({ code: e.code, message: e.message }));
    },
    async loadDone(branch, type) {
      const s = await col.where("status", "==", "done").where("branch", "==", branch).where("type", "==", type).orderBy("doneAt", "desc").limit(50).get();
      return { items: s.docs.map(toObj), cursor: null, more: false };
    },
    async countDoneToday(branch, type) {
      const d0 = new Date(); d0.setHours(0, 0, 0, 0);
      const s = await col.where("status", "==", "done").where("branch", "==", branch).where("type", "==", type).where("doneAt", ">=", +d0).get();
      return s.size;
    },
    async markDone(id, by) {
      const cur = await col.doc(id).get();
      if (cur.exists && cur.data().status === "done") throw Object.assign(new Error("already_done"), { code: "already_done", by: cur.data().doneBy });
      await col.doc(id).update({ status: "done", doneAt: Date.now(), doneBy: by });
    },
    claim: (id, by) => col.doc(id).update({ openedBy: by, openedAt: Date.now() }),
    undoDone: id => col.doc(id).update({ status: "pending", doneAt: null, doneBy: null }),
    markHeld: (id, reason, note, by) => col.doc(id).update({ status: "held", holdReason: reason, holdNote: note || "", heldAt: Date.now(), heldBy: by }),
    unhold: id => col.doc(id).update({ status: "pending", holdReason: null, holdNote: null, heldAt: null, heldBy: null }),
    update: (id, patch) => col.doc(id).update(patch),
    imageUrl: async path => path,
  };
  return api;
}

/* ---------------------------- Firebase ---------------------------- */
async function liveBackend(role) {
  const u = n => `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-${n}.js`;
  const useStorage = IMAGE_STORE === "storage";
  const [A, AU, FS, AC, ST] = await Promise.all([u("app"), u("auth"), u("firestore"), u("app-check"), useStorage ? u("storage") : null].map(x => x && import(x)));
  const app = A.initializeApp(firebaseConfig);
  if (RECAPTCHA_SITE_KEY) AC.initializeAppCheck(app, {
    provider: RECAPTCHA_PROVIDER === "enterprise" ? new AC.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY) : new AC.ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true });
  const auth = AU.getAuth(app);
  const db = role === "staff"
    ? FS.initializeFirestore(app, { localCache: FS.persistentLocalCache({ tabManager: FS.persistentMultipleTabManager() }) })
    : FS.getFirestore(app);
  const st = useStorage ? ST.getStorage(app) : null;
  const col = FS.collection(db, "requests");
  const toObj = d => { const x = d.data(); return { id: d.id, ...x, createdAt: x.createdAt?.toMillis?.() ?? Date.now(), doneAt: x.doneAt?.toMillis?.() ?? null, heldAt: x.heldAt?.toMillis?.() ?? null, openedAt: x.openedAt?.toMillis?.() ?? null, inquiryAt: x.inquiryAt?.toMillis?.() ?? null, doctorRemindedAt: x.doctorRemindedAt?.toMillis?.() ?? null }; };

  const models = {};
  let AIref = null, aiInst = null, aiCfg = null;
  async function getModel(name = AI_MODEL) {
    if (models[name]) return models[name];
    if (aiInst) return (models[name] = AIref.getGenerativeModel(aiInst, { model: name, generationConfig: aiCfg }));
    const AI = await import(u("ai"));
    const S = AI.Schema;
    const props = {};
    ["patient_name","patient_name_ar","patient_name_en","patient_file_no","id_number","nationality","gender","dob","dob_raw","mobile",
     "leave_start","leave_start_raw","leave_days","leave_end","visit_date","reason","accompanied_by",
     "doctor_name","doctor_id","stamp_doctor_name","stamp_doctor_id","companion_name","companion_id","companion_dob","relationship","doc_title"].forEach(k => props[k] = S.string());
    props.document_kind = S.enumString({ enum: ["sick_leave", "companion_leave", "attendance", "other"] });
    props.quality = S.enumString({ enum: ["good", "blurry", "cropped", "not_document"] });
    const ai = AI.getAI(app, { backend: new AI.GoogleAIBackend(), useLimitedUseAppCheckTokens: true });
    const cfg = { responseMimeType: "application/json", responseSchema: S.object({ properties: props }), temperature: 0 };
    AIref = AI; aiInst = ai; aiCfg = cfg;
    return (models[name] = AI.getGenerativeModel(ai, { model: name, generationConfig: cfg }));
  }

  const api = {
    demo: false,
    /* --- المريض --- */
    async ensureAnon() { if (!auth.currentUser) await AU.signInAnonymously(auth); return auth.currentUser.uid; },
    aiEnabled: AI_ENABLED, // بدون مفتاح reCAPTCHA يشتغل لين يصير App Check إلزامي (2 نوفمبر 2026)
    async warmup() { try { await api.ensureAnon(); if (api.aiEnabled) await getModel(); } catch (e) { console.warn(e); } },
    extractTimeout: 45000,
    async extract(blob, type) {
      // صورة أصغر للقراءة فقط (أسرع رفع وأسرع معالجة) — الصورة المحفوظة تبقى بجودتها
      const small = blob.type === "application/pdf" ? blob : await compressImage(blob, 1280, 0.8);
      const b64 = await blobToBase64(small);
      const parts = [aiPrompt(type), { inlineData: { data: b64, mimeType: small.type || "image/jpeg" } }];
      const queue = [AI_MODEL, ...AI_FALLBACK_MODELS];
      const run = name => getModel(name).then(m => m.generateContent(parts)).then(r => JSON.parse(r.response.text()));
      return await new Promise((resolve, reject) => {
        let running = 0, done = false, lastErr, timer;
        const next = () => {
          if (done) return;
          const name = queue.shift();
          if (!name) { if (!running) { done = true; reject(lastErr || new Error("ai_failed")); } return; }
          running++;
          clearTimeout(timer); timer = setTimeout(next, AI_HEDGE_MS); // لو تأخر، شغّل اللي بعده بالتوازي
          run(name).then(v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } })
            .catch(e => { lastErr = e; console.warn("AI", name, e); running--; next(); }); // فشل؟ جرّب اللي بعده فوراً
        };
        next();
      });
    },
    async uploadImage(blob, onProgress) {
      const uid = await api.ensureAnon();
      const pdf = blob.type === "application/pdf";
      if (!useStorage) {
        // الخطة المجانية: الصورة مضغوطة داخل Firestore (حد المستند 1MB)
        onProgress?.(0.2);
        let data = "";
        if (pdf) { data = await blobToDataURL(blob); if (data.length > 950000) throw Object.assign(new Error("pdf_too_big"), { code: "pdf_too_big" }); }
        else for (const [side, q] of [[1600, .8], [1400, .72], [1250, .66], [1100, .6], [950, .55]]) {
          data = await blobToDataURL(await compressImage(blob, side, q)); if (data.length < 950000) break;
        }
        const id = FS.doc(FS.collection(db, "images")).id;
        const b = FS.writeBatch(db);
        b.set(FS.doc(db, "images", id), { uid, createdAt: FS.serverTimestamp(), size: data.length });
        b.set(FS.doc(db, "imageData", id), { uid, data, createdAt: FS.serverTimestamp() });
        await b.commit(); onProgress?.(1);
        return "fs:" + id;
      }
      const path = `uploads/${uid}/${Date.now()}.${pdf ? "pdf" : "jpg"}`;
      const task = ST.uploadBytesResumable(ST.ref(st, path), blob, { contentType: pdf ? "application/pdf" : "image/jpeg" });
      await new Promise((res, rej) => task.on("state_changed", s => onProgress?.(s.bytesTransferred / s.totalBytes), rej, res));
      return path;
    },
    // نفس الطلب بالضبط مرسل من قبل؟ (بصمة بدون بيانات شخصية مقروءة)
    async isDuplicate(key) {
      if (!key) return false;
      try { await api.ensureAnon(); return (await FS.getDoc(FS.doc(db, "dupKeys", key))).exists(); } catch { return false; }
    },
    async createRequest(data, key) {
      const uid = await api.ensureAnon();
      const ref = FS.doc(col);
      const payload = { ...data, uid, status: "pending", createdAt: FS.serverTimestamp() };
      if (key) {
        try {
          // الطلب + بصمته مع بعض: لو البصمة موجودة (مكرر) يرفض الاثنين
          const b = FS.writeBatch(db);
          b.set(ref, payload);
          b.set(FS.doc(db, "dupKeys", key), { uid, at: FS.serverTimestamp() });
          await b.commit(); return ref.id;
        } catch (e) {
          if (e?.code !== "permission-denied") throw e;
          if (await api.isDuplicate(key)) throw Object.assign(new Error("duplicate"), { code: "duplicate" });
          // قواعد الحماية لسى ما تحدّثت → نرسل الطلب بدون البصمة (ما يتوقف الرفع)
        }
      }
      await FS.setDoc(ref, payload);
      return ref.id;
    },
    /* --- الموظف --- */
    onAuth(cb) {
      return AU.onAuthStateChanged(auth, async user => {
        if (!user || user.isAnonymous) return cb(null);
        const s = await FS.getDoc(FS.doc(db, "staff", user.uid)).catch(() => null);
        cb(s?.exists() ? { uid: user.uid, email: user.email, name: s.data().name || user.email, role: s.data().role || "staff" } : { uid: user.uid, email: user.email, denied: true });
      });
    },
    login: (e, p) => AU.signInWithEmailAndPassword(auth, e, p),
    logout: () => AU.signOut(auth),
    watchPending(cb, onErr) {
      return FS.onSnapshot(FS.query(col, FS.where("status", "in", ["pending", "held"])), s => {
        const list = s.docs.map(toObj).sort((a, b) => a.createdAt - b.createdAt);
        cb(list, s.docChanges().filter(c => c.type === "added" && !s.metadata.fromCache && !c.doc.metadata.hasPendingWrites).map(c => c.doc.id));
      }, onErr);
    },
    async loadDone(branch, type, cursor, n = 30) {
      const cons = [FS.where("status", "==", "done"), FS.where("branch", "==", branch), FS.where("type", "==", type), FS.orderBy("doneAt", "desc"), FS.limit(n)];
      if (cursor) cons.splice(4, 0, FS.startAfter(cursor));
      const s = await FS.getDocs(FS.query(col, ...cons));
      return { items: s.docs.map(toObj), cursor: s.docs[s.docs.length - 1] || null, more: s.docs.length === n };
    },
    async countDoneToday(branch, type) {
      const d0 = new Date(); d0.setHours(0, 0, 0, 0);
      const q = FS.query(col, FS.where("status", "==", "done"), FS.where("branch", "==", branch), FS.where("type", "==", type), FS.where("doneAt", ">=", FS.Timestamp.fromDate(d0)));
      return (await FS.getCountFromServer(q)).data().count;
    },
    markDone: (id, by) => FS.runTransaction(db, async tx => {
      const ref = FS.doc(col, id), cur = await tx.get(ref);
      if (cur.exists() && cur.data().status === "done") throw Object.assign(new Error("already_done"), { code: "already_done", by: cur.data().doneBy });
      tx.update(ref, { status: "done", doneAt: FS.serverTimestamp(), doneBy: by });
    }),
    claim: (id, by) => FS.updateDoc(FS.doc(col, id), { openedBy: by, openedAt: FS.serverTimestamp() }),
    undoDone: id => FS.runTransaction(db, async tx => {
      const ref = FS.doc(col, id), cur = await tx.get(ref);
      if (cur.data()?.status !== "done") return;
      tx.update(ref, { status: "pending", doneAt: null, doneBy: null });
    }),
    // تعليق/إرجاع داخل معاملة: لو موظف ثاني رفعه بنفس اللحظة ما نرجّعه للانتظار (يمنع الرفع مرتين)
    markHeld: (id, reason, note, by) => FS.runTransaction(db, async tx => {
      const ref = FS.doc(col, id), cur = await tx.get(ref);
      if (cur.data()?.status === "done") throw Object.assign(new Error("already_done"), { code: "already_done", by: cur.data().doneBy });
      tx.update(ref, { status: "held", holdReason: reason, holdNote: note || "", heldAt: FS.serverTimestamp(), heldBy: by });
    }),
    unhold: id => FS.runTransaction(db, async tx => {
      const ref = FS.doc(col, id), cur = await tx.get(ref);
      if (cur.data()?.status !== "held") return;
      tx.update(ref, { status: "pending", holdReason: null, holdNote: null, heldAt: null, heldBy: null });
    }),
    update: (id, patch) => FS.updateDoc(FS.doc(col, id), patch),
    async imageUrl(path) {
      if (String(path).startsWith("fs:")) {
        const d = await FS.getDoc(FS.doc(db, "imageData", path.slice(3)));
        if (!d.exists()) throw Object.assign(new Error("image_deleted"), { code: "image_deleted" });
        return d.data().data;
      }
      return ST.getDownloadURL(ST.ref(st, path));
    },
    /* --- طلبات التعديل (الموظف ← بوت الواتساب ← المريض) --- */
    newFixId: () => FS.doc(FS.collection(db, "fixes")).id,
    async createFix(req, data, id) {
      const ref = id ? FS.doc(db, "fixes", id) : FS.doc(FS.collection(db, "fixes"));
      // داخل معاملة: لو موظف ثاني (حتى بنفس الحساب) أرسل تعديل أو رفعه بنفس اللحظة → ما نرسل مرتين
      await FS.runTransaction(db, async tx => {
        const rr = FS.doc(col, req.id), cur = (await tx.get(rr)).data() || {};
        if (cur.status === "done") throw Object.assign(new Error("already_done"), { code: "already_done", by: cur.doneBy });
        if (cur.status === "held" && cur.fixToken) throw Object.assign(new Error("already_fixing"), { code: "already_fixing", by: cur.heldBy, at: cur.heldAt?.toMillis?.() || null });
        tx.set(ref, { ...data, reqId: req.id, ref: req.ref || "", name: req.patientName || "", phone: req.phone || "", type: req.type, status: "open", createdAt: FS.serverTimestamp() });
        tx.update(rr, { status: "held", holdReason: "data", holdNote: data.note || "بانتظار تعديل المريض", heldAt: FS.serverTimestamp(), heldBy: data.by || "", fixToken: ref.id, fixAt: FS.serverTimestamp() });
      });
      return ref.id;
    },
    watchFix(id, cb) { return FS.onSnapshot(FS.doc(db, "fixes", id), d => cb(d.exists() ? { id: d.id, ...d.data() } : null), () => cb(null)); },
    watchAnsweredFixes(cb) { return FS.onSnapshot(FS.query(FS.collection(db, "fixes"), FS.where("status", "==", "answered")), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => console.warn("fixes", e)); },
    applyFix: (fixId, patch, by) => FS.runTransaction(db, async tx => {
      const fr = FS.doc(db, "fixes", fixId), f = await tx.get(fr);
      if (!f.exists() || f.data().status !== "answered") return false;      // موظف ثاني طبّقه
      const rr = FS.doc(col, f.data().reqId), r = await tx.get(rr);
      if (r.exists() && r.data().status !== "done") tx.update(rr, { ...patch, status: "pending", holdReason: null, holdNote: null, heldAt: null, heldBy: null });
      tx.update(fr, { status: "applied", appliedAt: FS.serverTimestamp(), appliedBy: by || "" });
      return true;
    }),
    cancelFix: id => FS.updateDoc(FS.doc(db, "fixes", id), { status: "cancelled" }),
    markFixManual: id => FS.updateDoc(FS.doc(db, "fixes", id), { sendStatus: "manual" }),
    watchBot(cb) { return FS.onSnapshot(FS.doc(db, "bot", "status"), d => { const x = d.exists() ? d.data() : null; cb(x && { ...x, lastSeen: x.lastSeen?.toMillis?.() ?? 0, lastTest: x.lastTest ? { ...x.lastTest, at: x.lastTest.at?.toMillis?.() ?? 0 } : null }); }, () => cb(null)); },
    botLogout: () => FS.setDoc(FS.doc(db, "bot", "control"), { cmd: "logout", at: FS.serverTimestamp() }),
    async getDoctorPhones() { const d = await FS.getDoc(FS.doc(db, "bot", "doctors")); return d.exists() ? (d.data().phones || {}) : {}; },
    async exportAll() { const s = await FS.getDocs(col); return s.docs.map(toObj).sort((a, b) => a.createdAt - b.createdAt); },
    /* --- جداول الأطباء (مستند واحد لكل فرع) --- */
    watchBoard(cb, onErr) { return FS.onSnapshot(FS.doc(db, "board", "bawadi"), d => cb(d.exists() ? d.data() : null), onErr); },
    // التعديل داخل معاملة على آخر نسخة (لو جهازين عدّلوا بنفس اللحظة ما يضيع تعديل أحد)
    saveBoard: (mutate, by, what) => FS.runTransaction(db, async tx => {
      const ref = FS.doc(db, "board", "bawadi"), cur = (await tx.get(ref)).data() || null;
      const next = mutate(cur ? structuredClone(cur) : null);
      next.log = [{ at: Date.now(), by: by || "", what: what || "" }, ...(cur?.log || [])].slice(0, 60);
      next.updatedAt = Date.now(); next.updatedBy = by || "";
      tx.set(ref, next);
    }),
    botTest: phone => FS.setDoc(FS.doc(db, "bot", "control"), { cmd: "test", phone, at: FS.serverTimestamp() }),
    saveDoctorPhones: (phones, names) => FS.setDoc(FS.doc(db, "bot", "doctors"), { phones, names, at: FS.serverTimestamp() }),
    // يحجز أول رقم جهاز فاضي (مستند بصمة ما ينكتب فوقه — نفس قواعد dupKeys بدون أي تعديل)
    async claimDeviceNo() {
      for (let n = 1; n < 200; n++) {
        const ref = FS.doc(db, "dupKeys", await devKey(n));
        try {
          await FS.runTransaction(db, async tx => {
            if ((await tx.get(ref)).exists()) throw Object.assign(new Error("taken"), { code: "taken" });
            tx.set(ref, { uid: auth.currentUser.uid, at: FS.serverTimestamp() });
          });
          return n;
        } catch (e) { if (e?.code !== "taken" && e?.code !== "permission-denied") throw e; }
      }
      return 0;
    },
    /* --- المراجع: متابعة الطلب + رقم البوت --- */
    async getTrack(key) { await api.ensureAnon(); const d = await FS.getDoc(FS.doc(db, "track", key)); return d.exists() ? (d.data().items || {}) : null; },
    async getBotWa() { try { const d = await FS.getDoc(FS.doc(db, "public", "bot")); return d.exists() ? String(d.data().wa || "") : ""; } catch { return ""; } },
    async getFix(id) { await api.ensureAnon(); const d = await FS.getDoc(FS.doc(db, "fixes", id)); return d.exists() ? { id: d.id, ...d.data() } : null; },
    async answerFix(id, answer) { await api.ensureAnon(); await FS.updateDoc(FS.doc(db, "fixes", id), { status: "answered", answer, answeredAt: FS.serverTimestamp() }); },
    /* --- تنظيف الصور الشهري (للمسؤول) --- */
    ...(useStorage ? {} : {
      async oldImages(cutoffMs) {
        const active = await FS.getDocs(FS.query(col, FS.where("status", "in", ["pending", "held"])));
        const keep = new Set(active.docs.map(d => d.data().imagePath).filter(p => String(p).startsWith("fs:")).map(p => p.slice(3)));
        // صور تعديلات المرضى اللي لسى ما تطبّقت
        const fx = await FS.getDocs(FS.query(FS.collection(db, "fixes"), FS.where("status", "in", ["open", "answered"])));
        fx.docs.forEach(d => { const p = d.data().answer?.imagePath; if (String(p || "").startsWith("fs:")) keep.add(p.slice(3)); });
        const old = await FS.getDocs(FS.query(FS.collection(db, "images"), FS.where("createdAt", "<", FS.Timestamp.fromMillis(cutoffMs))));
        return old.docs.filter(d => !keep.has(d.id)).map(d => ({ id: d.id, size: d.data().size || 0 }));
      },
      async cleanupImages(cutoffMs, onProgress) {
        const list = await api.oldImages(cutoffMs);
        let b = FS.writeBatch(db), n = 0, done = 0;
        for (const im of list) {
          b.delete(FS.doc(db, "imageData", im.id)); b.delete(FS.doc(db, "images", im.id)); n += 2; done++;
          if (n >= 400) { await b.commit(); b = FS.writeBatch(db); n = 0; onProgress?.(done / list.length); }
        }
        if (n) await b.commit();
        onProgress?.(1);
        return list.length;
      },
    }),
  };
  return api;
}

/* ---------------------------- وضع تجريبي ---------------------------- */
function demoBackend() {
  const KEY = "saba_leave_demo_v2", bc = "BroadcastChannel" in window ? new BroadcastChannel(KEY) : null;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
  const save = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { console.warn("demo storage full", e); } bc?.postMessage("x"); fire(); };
  const FXKEY = KEY + "_fixes";
  const loadFx = () => { try { return JSON.parse(localStorage.getItem(FXKEY)) || []; } catch { return []; } };
  const saveFx = fx => { try { localStorage.setItem(FXKEY, JSON.stringify(fx)); } catch {} bc?.postMessage("x"); fire(); };
  const demoBot = () => { try { return localStorage.getItem("saba_demo_bot") === "1"; } catch { return false; } };
  let listeners = [];
  const fire = () => listeners.forEach(f => f());
  bc && (bc.onmessage = fire);
  window.addEventListener("storage", e => (e.key === KEY || e.key === KEY + "_fixes" || e.key === KEY + "_board") && fire());

  if (!load()) save(seed());

  const api = {
    demo: true,
    ensureAnon: async () => "demo",
    warmup: async () => {},
    async extract(blob, type) {
      await new Promise(r => setTimeout(r, 2200));
      const d = DOCTORS[Math.floor(Math.random() * DOCTORS.length)];
      return { patient_name: "محمد عبدالله الغامدي", patient_name_ar: "محمد عبدالله الغامدي", patient_name_en: "MOHAMMED ABDULLAH ALGHAMDI",
        patient_file_no: "7400123", nationality: "Saudi Arabia", gender: "Male", mobile: "966551234567", reason: "Acute gastroenteritis",
        stamp_doctor_name: "Dr. " + d.en, stamp_doctor_id: d.id, document_kind: type === "companion" ? "companion_leave" : type === "attendance" ? "attendance" : "sick_leave",
        id_number: "1098765432", dob: "1991-03-14", leave_start: new Date().toISOString().slice(0, 10), leave_end: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10),
        leave_days: "3", visit_date: new Date().toISOString().slice(0, 10), doctor_name: "Dr. " + d.en, doctor_id: d.id,
        companion_name: type === "companion" ? "عبدالله سعيد الغامدي" : "", companion_id: type === "companion" ? "1022334455" : "", companion_dob: type === "companion" ? "1965-07-02" : "", relationship: type === "companion" ? "ابن" : "", quality: "good" };
    },
    async uploadImage(blob, onProgress) {
      for (let i = 1; i <= 5; i++) { await new Promise(r => setTimeout(r, 120)); onProgress?.(i / 5); }
      const small = blob.type === "application/pdf" ? blob : await compressImage(blob, 900, 0.7);
      return await blobToDataURL(small);
    },
    async isDuplicate(key) { try { return !!key && JSON.parse(localStorage.getItem(KEY + "_dup") || "[]").includes(key); } catch { return false; } },
    async createRequest(data, key) {
      if (key && await api.isDuplicate(key)) throw Object.assign(new Error("duplicate"), { code: "duplicate" });
      const list = load() || []; const id = "d" + Date.now();
      list.push({ ...data, id, status: "pending", createdAt: Date.now() }); save(list);
      if (key) try { localStorage.setItem(KEY + "_dup", JSON.stringify([...JSON.parse(localStorage.getItem(KEY + "_dup") || "[]"), key].slice(-500))); } catch {}
      return id;
    },
    onAuth(cb) { const u = sessionStorage.getItem(KEY + "_u"); cb(u ? { uid: "demo", email: u, name: u.split("@")[0] } : null); api._authCb = cb; return () => {}; },
    async login(e) { sessionStorage.setItem(KEY + "_u", e || "staff@saba.sa"); api._authCb?.({ uid: "demo", email: e, name: (e || "staff").split("@")[0] }); },
    async logout() { sessionStorage.removeItem(KEY + "_u"); api._authCb?.(null); },
    watchPending(cb) {
      let known = null; const everSeen = new Set();
      const run = () => {
        const list = (load() || []).filter(x => x.status === "pending" || x.status === "held").sort((a, b) => a.createdAt - b.createdAt);
        const added = known ? list.filter(x => !everSeen.has(x.id)).map(x => x.id) : [];
        known = true; list.forEach(x => everSeen.add(x.id)); cb(list, added);
      };
      listeners.push(run); run();
      return () => listeners = listeners.filter(f => f !== run);
    },
    async loadDone(branch, type) {
      const items = (load() || []).filter(x => x.status === "done" && x.branch === branch && x.type === type).sort((a, b) => b.doneAt - a.doneAt);
      return { items, cursor: null, more: false };
    },
    async countDoneToday(branch, type) {
      const d0 = new Date(); d0.setHours(0, 0, 0, 0);
      return (load() || []).filter(x => x.status === "done" && x.branch === branch && x.type === type && x.doneAt >= +d0).length;
    },
    async markDone(id, by) { const l = load(); const x = l.find(r => r.id === id); if (x?.status === "done") throw Object.assign(new Error("already_done"), { code: "already_done", by: x.doneBy }); if (x) { x.status = "done"; x.doneAt = Date.now(); x.doneBy = by; } save(l); },
    async claim(id, by) { const l = load(); const x = l.find(r => r.id === id); if (x) { x.openedBy = by; x.openedAt = Date.now(); } save(l); },
    async undoDone(id) { const l = load(); const x = l.find(r => r.id === id); if (x) { x.status = "pending"; x.doneAt = null; x.doneBy = null; } save(l); },
    async markHeld(id, reason, note, by) { const l = load(); const x = l.find(r => r.id === id); if (x?.status === "done") throw Object.assign(new Error("already_done"), { code: "already_done", by: x.doneBy }); if (x) Object.assign(x, { status: "held", holdReason: reason, holdNote: note || "", heldAt: Date.now(), heldBy: by }); save(l); },
    async unhold(id) { const l = load(); const x = l.find(r => r.id === id); if (x) Object.assign(x, { status: "pending", holdReason: null, holdNote: null, heldAt: null, heldBy: null }); save(l); },
    async update(id, patch) { const l = load(); const x = l.find(r => r.id === id); if (x) Object.assign(x, patch); save(l); },
    imageUrl: async path => path,
    // طلبات التعديل (تجريبي) — لتجربة البوت: localStorage.saba_demo_bot = "1"
    newFixId: () => Array.from({ length: 20 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]).join(""),
    async createFix(req, data, id) {
      id ||= api.newFixId();
      const cur = load().find(r => r.id === req.id) || {};
      if (cur.status === "done") throw Object.assign(new Error("already_done"), { code: "already_done", by: cur.doneBy });
      if (cur.status === "held" && cur.fixToken) throw Object.assign(new Error("already_fixing"), { code: "already_fixing", by: cur.heldBy, at: cur.heldAt || null });
      const fx = loadFx(); fx.push({ ...data, id, reqId: req.id, ref: req.ref || "", name: req.patientName || "", phone: req.phone || "", type: req.type, status: "open", createdAt: Date.now() }); saveFx(fx);
      await api.update(req.id, { status: "held", holdReason: "data", holdNote: data.note || "بانتظار تعديل المريض", heldAt: Date.now(), heldBy: data.by || "", fixToken: id, fixAt: Date.now() });
      if (demoBot() && data.sendStatus === "queued") setTimeout(() => { const f = loadFx(); const x = f.find(y => y.id === id); if (x) { x.sendStatus = "sent"; x.sentAt = Date.now(); saveFx(f); } }, 1200);
      return id;
    },
    watchFix(id, cb) { const run = () => cb(loadFx().find(x => x.id === id) || null); listeners.push(run); run(); return () => { listeners = listeners.filter(f => f !== run); }; },
    watchAnsweredFixes(cb) { const run = () => cb(loadFx().filter(x => x.status === "answered")); listeners.push(run); run(); return () => {}; },
    async applyFix(fixId, patch, by) {
      const fx = loadFx(), f = fx.find(x => x.id === fixId); if (!f || f.status !== "answered") return false;
      const l = load(), r = l.find(x => x.id === f.reqId);
      if (r && r.status !== "done") Object.assign(r, patch, { status: "pending", holdReason: null, holdNote: null, heldAt: null, heldBy: null });
      Object.assign(f, { status: "applied", appliedAt: Date.now(), appliedBy: by }); localStorage.setItem(FXKEY, JSON.stringify(fx)); save(l); return true;
    },
    async cancelFix(id) { const fx = loadFx(); const f = fx.find(x => x.id === id); if (f) f.status = "cancelled"; saveFx(fx); },
    async markFixManual(id) { const fx = loadFx(); const f = fx.find(x => x.id === id); if (f) f.sendStatus = "manual"; saveFx(fx); },
    watchBot(cb) { const run = () => cb(demoBot() ? { state: "connected", me: "966500000000", lastSeen: Date.now(), lastTest: api._lastTest || null } : { lastTest: api._lastTest || null }); listeners.push(run); run(); return () => {}; },
    async botLogout() {},
    async getDoctorPhones() { try { return JSON.parse(localStorage.getItem(KEY + "_docph") || "{}"); } catch { return {}; } },
    async saveDoctorPhones(phones) { localStorage.setItem(KEY + "_docph", JSON.stringify(phones)); },
    async claimDeviceNo() { const n = (+localStorage.getItem(KEY + "_devs") || 0) + 1; localStorage.setItem(KEY + "_devs", n); return n; },
    async exportAll() { return load(); },
    watchBoard(cb) { const f = () => { try { cb(JSON.parse(localStorage.getItem(KEY + "_board") || "null")); } catch { cb(null); } }; listeners.push(f); f(); return () => { listeners = listeners.filter(x => x !== f); }; },
    async saveBoard(mutate, by, what) {
      const cur = JSON.parse(localStorage.getItem(KEY + "_board") || "null"), next = mutate(cur ? structuredClone(cur) : null);
      next.log = [{ at: Date.now(), by: by || "", what: what || "" }, ...(cur?.log || [])].slice(0, 60); next.updatedAt = Date.now(); next.updatedBy = by || "";
      localStorage.setItem(KEY + "_board", JSON.stringify(next)); fire(); bc?.postMessage(1);
    },
    async botTest(phone) { api._lastTest = { phone, ok: demoBot(), err: demoBot() ? "" : "البوت مو متصل بواتساب", at: Date.now() }; fire(); },
    async getTrack(key) {
      const items = {};
      for (const r of load() || []) if (await trackKey(r.idNumber, r.phone) === key)
        items[r.id] = { ref: r.ref, type: r.type, state: r.status === "done" && /^مكرر تلقائياً/.test(r.doneBy || "") ? "dup" : r.status, hold: r.status === "held" ? r.holdReason || "" : "", fix: r.status === "held" && r.fixToken ? r.fixToken : "", leaveStart: r.leaveStart || "", leaveEnd: r.leaveEnd || "", visitDate: r.visitDate || "", createdAt: r.createdAt, doneAt: r.doneAt || 0 };
      return Object.keys(items).length ? items : null;
    },
    async getBotWa() { return demoBot() ? "966500000000" : ""; },
    async getFix(id) { return loadFx().find(x => x.id === id) || null; },
    async answerFix(id, answer) { const fx = loadFx(); const f = fx.find(x => x.id === id); if (!f || f.status !== "open") throw Object.assign(new Error("closed"), { code: "permission-denied" }); Object.assign(f, { status: "answered", answer, answeredAt: Date.now() }); saveFx(fx); },
  };
  return api;
}

function demoDoc(name, id, docName, kind) {
  const c = document.createElement("canvas"); c.width = 620; c.height = 820;
  const g = c.getContext("2d");
  g.fillStyle = "#fbfcfd"; g.fillRect(0, 0, 620, 820);
  g.fillStyle = "#0082D4"; g.fillRect(0, 0, 620, 90);
  g.fillStyle = "#fff"; g.font = "bold 30px sans-serif"; g.textAlign = "center"; g.fillText(kind, 310, 56);
  g.fillStyle = "#003765"; g.textAlign = "right"; g.font = "22px sans-serif";
  const rows = [["اسم المريض", name], ["رقم الهوية", id], ["الطبيب المعالج", docName], ["تاريخ الإصدار", new Date().toLocaleDateString("en-GB")]];
  rows.forEach(([k, v], i) => { g.fillStyle = "#6b8299"; g.fillText(k, 580, 160 + i * 90); g.fillStyle = "#003765"; g.font = "bold 24px sans-serif"; g.fillText(v, 580, 195 + i * 90); g.font = "22px sans-serif"; });
  g.strokeStyle = "#cfe3f1"; for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(40, 560 + i * 26); g.lineTo(580, 560 + i * 26); g.stroke(); }
  g.save(); g.translate(310, 470); g.rotate(-0.5); g.fillStyle = "rgba(0,130,212,.12)"; g.font = "bold 64px sans-serif"; g.textAlign = "center"; g.fillText("نموذج تجريبي", 0, 0); g.restore();
  return c.toDataURL("image/jpeg", 0.6);
}
function seed() {
  const people = [
    ["سعد خالد الحربي", "1087654321", "rasha-waziri", "sick", 34],
    ["Fatimah Ali Hassan", "2456789012", "ehab-metwally", "sick", 21],
    ["نورة عبدالرحمن القحطاني", "1122334455", "nashwa-saqqa", "companion", 15],
    ["عمر سالم باوزير", "1099887766", "", "sick", 9],
    ["Ahmed Youssef Mahmoud", "2387766554", "elham-shaheen", "attendance", 6],
    ["ريم فهد العتيبي", "1144556677", "khaled-allam", "attendance", 3],
    ["ماجد حسن الزهراني", "1066554433", "sara-shoreiji", "sick", 2],
    ["هند محمد الشهري", "1033221100", "rami-kilany", "sick", 300],
    ["Yasser Kamal", "2211009988", "wafaa-mohamed", "sick", 200],
  ];
  return people.map(([n, id, did, type, mins], i) => {
    const d = doctorById(did);
    const docName = d ? (n.match(/[a-z]/i) ? "Dr. " + d.en : "د. " + d.ar) : "د. أكرم الشرقاوي";
    const done = i >= 7;
    const t = Date.now() - mins * 60000;
    const today = isoToDmy(new Date(t).toISOString());
    return { id: "seed" + i, ref: "SB-" + (48210 + i), type, patientName: n, idNumber: id, dob: "14/03/1990", phone: "05" + String(51234567 + i * 1111),
      leaveStart: type === "attendance" ? "" : today, leaveEnd: type === "attendance" ? "" : today, leaveDays: type === "attendance" ? "" : "1",
      visitDate: type === "attendance" ? today : "", doctorName: docName, doctorId: did || "", branch: d ? d.branch : DEFAULT_BRANCH,
      companionName: type === "companion" ? "فهد عبدالرحمن القحطاني" : "", companionId: type === "companion" ? "1011223344" : "", companionDob: type === "companion" ? "02/07/1985" : "", relationship: type === "companion" ? "زوج" : "",
      ...(i === 3 ? { holdReason: "license", holdNote: "الطبيب غير مسجل في أي فرع", heldAt: t + 120000, heldBy: "anas" } : {}),
      imagePath: demoDoc(n, id, docName, typeName(type)), status: done ? "done" : i === 3 ? "held" : "pending", createdAt: t, doneAt: done ? t + 600000 : null, doneBy: done ? "anas" : null, aiFilled: true };
  });
}
