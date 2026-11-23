// (2.21.0) دوام مختلف لكل يوم — «السبت والأحد والأربعاء من ٤م-١١م / الاثنين والثلاثاء ٩ص-٦م / الخميس ١م-١٠م»
// الجدول يحفظ: shifts (الدوام الأساسي) + alts: [{ days, shifts }] (مجموعات أيام بدوام ثاني). alt = أول مجموعة (للصفحات القديمة)

const latin = s => String(s || "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
const norm = s => latin(s).toLowerCase()
  .replace(/[ً-ْـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
  .replace(/[^\p{L}\p{N}\s:\/\-–]/gu, " ").replace(/\s+/g, " ").trim();

// مجموعات الأيام المختلفة (الجديد alts، والقديم alt)
export const altsOf = d => (d?.alts?.length ? d.alts : d?.alt?.days?.length ? [d.alt] : []).filter(g => g?.days?.length);
export const shiftsFor = (d, wd) => { const g = altsOf(d).find(g => g.days.includes(wd)); return g ? g.shifts || [] : d?.shifts || []; };
export function setAlts(t, list) {
  const L = (list || []).filter(g => g?.days?.length).map(g => ({ days: [...new Set(g.days)].sort((a, b) => a - b), shifts: g.shifts || [] }));
  if (L.length) { t.alts = L; t.alt = L[0]; } else { delete t.alts; delete t.alt; }
}
const J = x => JSON.stringify((x || []).map(y => [y.s, y.e]));
export const sameShifts = (a, b) => J(a) === J(b);

// نسخة كاملة من الأسبوع: { 6:[…], 0:[…], … } — للمقارنة والتحقق
export function weekMap(d) { const o = {}; for (const w of d?.workdays || []) o[w] = J(shiftsFor(d, w)); return o; }

// «كل خميس 9-5» وباقي الأيام زي ما هي: نشيل الأيام من كل المجموعات، ونحطها مع اللي نفس دوامها أو مجموعة جديدة
export function putDays(t, days, shifts) {
  let L = altsOf(t).map(g => ({ days: g.days.filter(x => !days.includes(x)), shifts: g.shifts }));
  if (!sameShifts(t.shifts, shifts)) {
    const g = L.find(g => sameShifts(g.shifts, shifts));
    if (g) g.days.push(...days); else L.push({ days: [...days], shifts });
  }
  setAlts(t, L);
}

/* ---------- قراءة جدول أسبوع من الكلام ---------- */
const DAYW = [["احد", 0], ["اثنين", 1], ["ثلاثاء", 2], ["ثلاثا", 2], ["اربعاء", 3], ["اربعا", 3], ["خميس", 4], ["جمعه", 5], ["سبت", 6]];
const daysIn = n => { const out = []; for (const [k, i] of DAYW) if (new RegExp("(^|[\\s:/])(يوم\\s+|ايام\\s+)?(ال|و|وال|بال|لل)?" + k + "(?=[\\s:،,]|$)").test(n) && !out.includes(i)) out.push(i); return out; };
// «من ٤ م إلى ١١ م» / «٩-٦» / «1 pm - 10 pm» → فترات (فترة أو فترتين)
const AP = "(ص|م|صباحا|صباح|الصبح|الصباح|مساء|مساءا|المساء|العصر|عصر|الظهر|ظهرا|ظهر|بالليل|الليل|ليلا|am|pm|a m|p m)";
const RANGE = new RegExp("(\\d{1,2})(?::(\\d{2}))?\\s*" + AP + "?\\s*(?:-|–|الى|الي|لين|الين|لحد|حتى|ل)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*" + AP + "?", "g");
const isPM = a => /^(م|مساء|مساءا|المساء|العصر|عصر|الظهر|ظهرا|ظهر|بالليل|الليل|ليلا|pm|p m)$/.test(a || "");
const isAM = a => /^(ص|صباحا|صباح|الصبح|الصباح|am|a m)$/.test(a || "");
function rangesIn(n) {
  const out = [];
  for (const m of n.matchAll(RANGE)) {
    const fa = m[3] || "", ta = m[6] || "";
    const h24 = (h, a, other) => { h = +h % 12; if (isPM(a)) return h + 12; if (isAM(a)) return h; if (isPM(other) && !isAM(a)) return h < 8 ? h + 12 : h; return h < 8 ? h + 12 : h; };
    let s = h24(m[1], fa, ta) * 60 + (+m[2] || 0), e = h24(m[4], ta, fa) * 60 + (+m[5] || 0);
    if (!fa && isPM(ta) && s >= e && s - 720 >= 0 && s - 720 < e) s -= 720;          // «١٠-١ م» → ١٠ص–١م
    if (!ta && e <= s && e + 720 > s) e += 720;                                     // «٥ م إلى ١٠:٣٠» = ١٠:٣٠م
    if (e > 1440) e -= 1440;
    if (s === e) continue;
    out.push({ s: s % 1440, e: e % 1440 });
  }
  return out;
}
const OFF = /(^|\s)(اجازه|اجازة|off|اوف|راحه|ما يداوم|ماتداوم|ما تداوم|مايداوم|لا يوجد دوام|بدون دوام)(\s|$)/;

// يوم البداية: «٢٨/١١» أو «ابتداء من السبت» / «من يوم السبت» / «بداية من الأحد»
export function startOf(text, today, wdToday) {
  const n = norm(text);
  const dm = /(^|[^\d])(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?(?!\d)/.exec(n);
  const plus = k => { const x = new Date(today + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
  if (dm) {
    const d = +dm[2], mo = +dm[3]; let y = dm[4] ? +dm[4] : +today.slice(0, 4); if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      let iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (!dm[4] && iso < plus(-60)) iso = `${y + 1}${iso.slice(4)}`;
      return iso;
    }
  }
  const w = /(^|\s)(من|ابتداء من|ابتداء|ابتدا من|اعتبارا من|بدايه من|بدايه|بداية من|يبدا|تبدا|يباشر|تباشر)\s+(يوم\s+)?(ال)?(سبت|احد|اثنين|ثلاثاء|ثلاثا|اربعاء|اربعا|خميس)/.exec(n);
  if (w) { const i = DAYW.find(([k]) => k === w[5])[1]; return plus((i - wdToday + 7) % 7); }
  if (/(^|\s)(بكره|بكرا|غدا|باكر)(\s|$)/.test(n)) return plus(1);
  return null;
}

// الرسالة جدول أسبوع لطبيب واحد؟ → { groups:[{days, shifts}], off:[days] } أو null
// لازم سطرين أو أكثر فيها أيام + وقت، وبدوامين مختلفين على الأقل (غير كذا الطريقة العادية تكفي)
const PERM = /(^|\s)(ثابت|ثابته|دائم|دائمه|دايم|دايمه|من الحين|من اليوم وطالع|ابتداء|ابتدا|اعتبارا|بدايه من|بداية من|كل اسبوع)(\s|$)/;
const TEMP = /(^|\s)(هالاسبوع|هذا الاسبوع|الاسبوع هذا|بس|فقط|مؤقت|مؤقتا|لمده|لين يرجع|اليوم|الليله|بكره|بكرا|غدا)(\s|$)/;
export function weekOf(text) {
  { const n = norm(text); if (TEMP.test(n) && !PERM.test(n)) return null;       // «هالأسبوع بس / بكرة» → مو جدول ثابت
    if ((n.match(/(^|\s)(د|دكتور|دكتوره|الدكتور|الدكتوره|دكتورة)(?=\s)/g) || []).length > 1) return null; }   // جدول لأكثر من طبيب
  const segs = String(text || "").split(/\n+|،|؛|;|\s\|\s/).map(s => norm(s)).filter(Boolean);
  const rows = [], off = [];
  for (const s of segs) {
    const ds = daysIn(s).filter(x => x !== 5); if (!ds.length) continue;
    if (/(^|\s)(من|ابتداء من|ابتداء|اعتبارا من|بدايه من|بداية من|يباشر|تباشر)\s+(يوم\s+)?(ال)?(سبت|احد|اثنين|ثلاثاء|ثلاثا|اربعاء|اربعا|خميس)/.test(s) && !rangesIn(s.replace(/\d{1,2}\s*\/\s*\d{1,2}(\s*\/\s*\d{2,4})?/g, " ")).length) continue;   // «ابتداء من السبت ٢٨/١١» = البداية
    if (OFF.test(s)) { off.push(...ds); continue; }
    const r = rangesIn(s.replace(/\d{1,2}\s*\/\s*\d{1,2}(\s*\/\s*\d{2,4})?/g, " ")).slice(0, 2);
    if (!r.length) continue;
    rows.push({ days: ds, shifts: r });
  }
  if (rows.length < 2) return null;
  const groups = [];
  for (const r of rows) {
    for (const g of groups) g.days = g.days.filter(x => !r.days.includes(x));                  // يوم انكتب مرتين → الأخير يغلب
    const g = groups.find(g => sameShifts(g.shifts, r.shifts));
    if (g) g.days.push(...r.days); else groups.push({ days: [...r.days], shifts: r.shifts });
  }
  const G = groups.filter(g => g.days.length).map(g => ({ days: [...new Set(g.days)].sort((a, b) => a - b), shifts: g.shifts }));
  if (G.length < 2) return null;
  return { groups: G, off: [...new Set(off)].filter(x => !G.some(g => g.days.includes(x))) };
}

// مجموعات → سجل الجدول: الأساسي = المجموعة اللي أيامها أكثر (لو تعادل: الأولى)
export function weekSch(groups) {
  const order = [...groups].map((g, i) => ({ ...g, i })).sort((a, b) => b.days.length - a.days.length || a.i - b.i);
  const main = order[0], rest = order.slice(1).sort((a, b) => a.i - b.i).map(({ days, shifts }) => ({ days, shifts }));
  const days = [...new Set(groups.flatMap(g => g.days))].filter(x => x !== 5).sort((a, b) => a - b);
  return { days, shifts: main.shifts, alts: rest, week: true };
}

const DAYN = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const ORD = [6, 0, 1, 2, 3, 4, 5];
const hm = m => { m = ((m % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mi = m % 60; return `${h % 12 || 12}${mi ? ":" + String(mi).padStart(2, "0") : ""}${h < 12 ? "ص" : "م"}`; };
export const shTxt = l => (l || []).map(s => `${hm(s.s)} – ${hm(s.e)}`).join(" و ");
// «السبت والأحد والأربعاء: 4م – 11م · الإثنين والثلاثاء: 9ص – 6م · الخميس: 1م – 10م»
export function weekTxt(sch) {
  const gs = [{ days: (sch.days || []).filter(w => !(sch.alts || []).some(g => g.days.includes(w))), shifts: sch.shifts }, ...(sch.alts || [])].filter(g => g.days.length);
  return gs.map(g => `${ORD.filter(w => g.days.includes(w)).map(w => DAYN[w]).join(" و")}: ${shTxt(g.shifts)}`).join(" · ");
}
