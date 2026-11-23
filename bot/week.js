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

const DAYRX = "(سبت|احد|اثنين|ثلاثاء|ثلاثا|اربعاء|اربعا|خميس)";
const dayIdx = k => DAYW.find(([x]) => x === k)[1];
const PERM = /(^|\s)(ثابت|ثابته|دائم|دائمه|دايم|دايمه|من الحين|من اليوم وطالع|ابتداء|ابتدا|اعتبارا|بدايه من|بداية من|كل اسبوع|الاسبوع الجاي|الاسبوع القادم|الاسبوع الياي|الاسبوع اللي بعده|والاسبوع الجاي|والاسبوع القادم)(\s|$)/;
const TEMPW = /(^|\s)(هالاسبوع|هذا الاسبوع|الاسبوع هذا|بس|فقط|مؤقت|مؤقتا|لمده)(\s|$)/;
const SKIP = /(اجاز|يغطي|تغطي|بدال|مكان|عيادته|عيادتها)/;

// التواريخ تتحوّل لـ «ت٢٤ت١١ت» قبل قراءة الأوقات (عشان «٢٤/١١ لين ٢٦/١١» ما تنقرا وقت)
const hideDates = n => n.replace(/(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*\d{2,4})?/g, " ت$1ت$2ت ");
function mkDate(today, wd) {
  const plus = k => { const x = new Date(today + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
  return {
    plus,
    dm: (d, mo) => { d = +d; mo = +mo; if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12)) return null; let y = +today.slice(0, 4), iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; if (iso < plus(-60)) iso = `${y + 1}${iso.slice(4)}`; return iso; },
    day: (k, next) => { const i = dayIdx(k); let k2 = (i - wd + 7) % 7; if (next && !k2) k2 = 7; return plus(k2); },
    thu: () => plus((4 - wd + 7) % 7),                                   // نهاية الأسبوع (الخميس)
    sat: () => plus(((6 - wd + 7) % 7) || 7),                             // السبت الجاي
  };
}
// تاريخ من كلمة: «بكرة» «اليوم» «السبت» «السبت الجاي» «ت28ت11ت»
function whenOf(tok, D) {
  let m;
  if ((m = /^ت(\d{1,2})ت(\d{1,2})ت/.exec(tok))) return D.dm(m[1], m[2]);
  if (/^(بكره|بكرا|غدا|باكر)/.test(tok)) return D.plus(1);
  if (/^(اليوم|الحين)/.test(tok)) return D.plus(0);
  if (/^(نهايه|اخر)\s+(ال)?اسبوع/.test(tok)) return D.thu();
  if ((m = new RegExp("^(يوم\\s+)?(ال)?" + DAYRX + "(\\s+(الجاي|القادم|الياي|الجايه|القادمه))?").exec(tok))) return D.day(m[3], !!m[4]);
  return null;
}
const WHEN = "(ت\\d{1,2}ت\\d{1,2}ت|بكره|بكرا|غدا|باكر|اليوم|الحين|(?:نهايه|اخر)\\s+(?:ال)?اسبوع|(?:يوم\\s+)?(?:ال)?" + DAYRX + "(?:\\s+(?:الجاي|القادم|الياي|الجايه|القادمه))?)";
const FROMX = new RegExp("(?:^|\\s)(?:من|ابتداء من|ابتداء|ابتدا من|اعتبارا من|بدايه من|بداية من|يبدا|تبدا|يباشر|تباشر)\\s+" + WHEN);
const UNTILX = new RegExp("(?:^|\\s)(?:لين|الين|الى|الي|حتى|لحد|ل)\\s+" + WHEN);

// يوم البداية: «٢٨/١١» أو «ابتداء من السبت» / «من يوم السبت» / «من الأسبوع الجاي»
export function startOf(text, today, wdToday) {
  const n = hideDates(norm(text)), D = mkDate(today, wdToday);
  const f = FROMX.exec(n); if (f) { const x = whenOf(f[1], D); if (x) return x; }
  const d = /ت(\d{1,2})ت(\d{1,2})ت/.exec(n); if (d) { const x = D.dm(d[1], d[2]); if (x) return x; }
  if (/(^|\s)(و)?(من\s+)?(ال)?اسبوع\s+(الجاي|القادم|الياي|اللي بعده)/.test(n)) return D.sat();
  if (/(^|\s)(بكره|بكرا|غدا|باكر)(\s|$)/.test(n)) return D.plus(1);
  return null;
}

/* (2.21.1) رسالة فيها لطبيب واحد: دوام مؤقت لفترة («هالأسبوع من بكرة لين الخميس ١م-٨م») و/أو جدول أسبوع ثابت بأوقات مختلفة
   → { tmp: { from, until, shifts } | null, week: { groups, start } | null } — أو null لو مو كذا */
export function planOf(text, today, wd, hour = 12) {
  const n0 = norm(text);
  if ((n0.match(/(^|\s)(د|دكتور|دكتوره|الدكتور|الدكتوره|دكتورة)(?=\s)/g) || []).length > 1) return null;   // جدول لأكثر من طبيب
  const D = mkDate(today, wd);
  // نقطّع: سطور/فواصل، وبعدها بعد كل وقت (عشان «… ٤-١١ والاثنين والثلاثاء ٩-٦» في سطر واحد)
  const pieces = [];
  for (const seg of String(text || "").split(/\n+|،|؛|;|\s\|\s/)) {
    const h = hideDates(norm(seg)); if (!h) continue;
    let last = 0; const R = new RegExp(RANGE.source, "g"); let m;
    while ((m = R.exec(h))) { pieces.push(h.slice(last, m.index + m[0].length)); last = m.index + m[0].length; }
    const rest = h.slice(last).trim(); if (rest) pieces.push(rest);
  }
  let tmp = null; const rows = [], weekTxt = [], off = [];
  for (const p of pieces) {
    const r = rangesIn(p.replace(/ت\d{1,2}ت\d{1,2}ت/g, " "));
    const fr = FROMX.exec(p), un = UNTILX.exec(p);
    const bare = p.replace(FROMX, " ").replace(UNTILX, " ");             // الأيام اللي برا «من…» و«لين…»
    const isDay = x => new RegExp("^(يوم\\s+)?(ال)?" + DAYRX).test(x);
    const isTmp = r.length && !PERM.test(p) && (TEMPW.test(p) || (un && !isDay(un[1])) || (fr && !isDay(fr[1])));
    if (isTmp) {
      if (SKIP.test(p)) return null;                                      // تغطية/إجازة → الطريقة العادية
      if (daysIn(bare).length) return null;                               // «هالأسبوع السبت ٩-٥ والأحد…» = أيام معيّنة مؤقتة → الطريقة العادية
      const f2 = fr && whenOf(fr[1], D), u2 = (un && whenOf(un[1], D)) || (TEMPW.test(p) ? D.thu() : null);
      if (tmp) {                                                          // «هالأسبوع ١-٨ … بمعنى من بكرة لين نهاية الأسبوع ١م-٨م» = نفس الفترة مشروحة مرتين
        if (!sameShifts(tmp.shifts, r.slice(0, 2))) return null;
        if (f2) tmp.from = f2; if (un && u2) tmp.until = u2; if (tmp.until < tmp.from) return null; continue;
      }
      const from = f2 || D.plus(hour >= 18 ? 1 : 0), until = u2;
      if (!until || until < from) return null;
      tmp = { from, until, shifts: r.slice(0, 2) }; continue;
    }
    weekTxt.push(p);
    let ds = daysIn(bare).filter(x => x !== 5);
    if (fr && un && new RegExp("^(يوم\\s+)?(ال)?" + DAYRX + "$").test(fr[1].trim()) && new RegExp("^(يوم\\s+)?(ال)?" + DAYRX + "$").test(un[1].trim())) {   // «من السبت لين الأربعاء ٤-١١»
      const a = dayIdx(new RegExp(DAYRX).exec(fr[1])[1]), b = dayIdx(new RegExp(DAYRX).exec(un[1])[1]), ORD = [6, 0, 1, 2, 3, 4];
      const ia = ORD.indexOf(a), ib = ORD.indexOf(b); if (ia >= 0 && ib >= ia) ds = [...new Set([...ds, ...ORD.slice(ia, ib + 1)])];
    }
    if (!ds.length) continue;
    if (OFF.test(p)) { off.push(...ds); continue; }
    if (!r.length) continue;
    rows.push({ days: ds, shifts: r.slice(0, 2) });
  }
  const groups = [];
  for (const r of rows) {
    for (const g of groups) g.days = g.days.filter(x => !r.days.includes(x));                  // يوم انكتب مرتين → الأخير يغلب
    const g = groups.find(g => sameShifts(g.shifts, r.shifts));
    if (g) g.days.push(...r.days); else groups.push({ days: [...r.days], shifts: r.shifts });
  }
  const G = groups.filter(g => g.days.length).map(g => ({ days: [...new Set(g.days)].sort((a, b) => a - b), shifts: g.shifts }));
  let week = null;
  if (G.length >= 2 || (G.length === 1 && tmp && PERM.test(n0))) {
    if (!tmp && !PERM.test(n0) && TEMPW.test(n0)) return null;            // «هالأسبوع بس…» بدون فترة واضحة → الطريقة العادية
    const wt = weekTxt.join("\n").replace(new RegExp("(^|\\s)من\\s+(يوم\\s+)?(ال)?" + DAYRX + "\\s+(لين|الين|الى|الي|حتى|لحد|ل)\\s+(يوم\\s+)?(ال)?" + DAYRX, "g"), " ");   // «من السبت لين الأربعاء» = أيام، مو بداية
    let start = startOf(wt.replace(/ت(\d{1,2})ت(\d{1,2})ت/g, "$1/$2"), today, wd);
    if (tmp && (!start || start <= tmp.until)) start = D.plus(Math.round((Date.parse(tmp.until) - Date.parse(today)) / 864e5) + 1);   // الثابت يبدأ بعد المؤقت
    week = { groups: G, start: start || "" };
  }
  if (!tmp && !week) return null;
  return { tmp, week, off: [...new Set(off)] };
}
// (للتوافق) جدول الأسبوع بس
export function weekOf(text, today = new Date().toISOString().slice(0, 10), wd = new Date().getUTCDay()) { const p = planOf(text, today, wd); return p?.week ? { groups: p.week.groups, off: p.off } : null; }

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
