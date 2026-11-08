// (2.12.1) مطابقة الأسماء (عربي/إنجليزي بالهيكل) — منسوخة من أداة صحة (seha.js) عشان البوت يطابق نفس الطريقة
const norm = s => String(s || "")
  .replace(/[ً-ْـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/[ىیئ]/g, "ي").replace(/ک/g, "ك").replace(/ؤ/g, "و").replace(/ة/g, "ه")
  .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[*:：]/g, " ").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
const docTokens = s => norm(s).toLowerCase().replace(/\b(dr|doctor)\b\.?|(^|\s)(د|دكتور|دكتوره)(\.|\s|$)/g, " ").replace(/(^|\s)(ال|al|el)[- ]?/g, " ")
  .replace(/(^|\s)(ابو|عبد|ابن|بن|بو)\s+/g, "$1$2").split(/[\s\-\/.]+/).map(t => t.replace(/^(ابو|عبد|ابن|بن|بو)ال(?=..)/, "$1")).filter(t => t.length > 1);
const DOC_COMMON = new Set(["محمد", "احمد", "عبدالله", "عبد", "علي", "حسن", "حسين", "محمود", "ابراهيم", "عبدالرحمن", "خالد", "عمر", "مصطفي", "سيد", "صالح",
  "mohamed", "mohammed", "muhammad", "mohammad", "ahmed", "ahmad", "ali", "abdullah", "abdel", "abdul", "hassan", "hussein", "mahmoud", "ibrahim", "khaled", "khalid", "omar", "mostafa", "mustafa", "saleh"]);
// (1.9.3) اسم الطبيب في الإجازة إنجليزي (Dr. Magdy Nassif) وقائمة صحة عربي (مجدي نصيف سكلا) → نقارن «هيكل» الاسم بالحروف الساكنة:
// مجدي = Magdy = mgd ، امجد = Amjad/Amgad = amgd ، نصيف = Nassif = nsf ، كامل = Kamel = kml (الحرف الأول لو حرف علة نحطه a عشان امجد ≠ مجدي)
const AR_SK = { "ب": "b", "ت": "t", "ط": "t", "ث": "s", "ج": "g", "ح": "h", "ه": "h", "ة": "h", "خ": "k", "د": "d", "ض": "d", "ذ": "z", "ز": "z", "ظ": "z", "ر": "r", "س": "s", "ص": "s", "ش": "s",
  "غ": "g", "ف": "f", "ق": "k", "ك": "k", "ل": "l", "م": "m", "ن": "n" };
function skel(tok) {
  let t = String(tok || "").toLowerCase(), lead = "";
  if (/[a-z]/.test(t)) {
    t = t.replace(/^(abou|abo)(?=.)/, "abu").replace(/^(abd|abu|bin|ibn)[-]?(el|al|ul|ol)(?=..)/, "$1");
    lead = /^[aeiou]/.test(t) ? "a" : "";
    t = t.replace(/kh/g, "k").replace(/sh/g, "s").replace(/gh/g, "g").replace(/ph/g, "f").replace(/th/g, "s").replace(/ch/g, "s")
      .replace(/[aeiouyw]/g, "").replace(/[cq]/g, "k").replace(/j/g, "g").replace(/x/g, "ks").replace(/v/g, "f").replace(/[^a-z]/g, "");
  } else {
    lead = /^[اأإآعء]/.test(t) ? "a" : "";
    t = [...t].map(c => AR_SK[c] ?? "").join("");
  }
  return lead + t.replace(/(.)\1+/g, "$1");
}
const SK_COMMON = new Set(["mhmd", "ahmd", "abdlh", "ab", "abd", "al", "hsn", "mhmd", "abrhm", "abdrhmn", "kld", "amr", "mstf", "sd", "slh"]);
// كلمات الاسم: العربي نفس docTokens، والإنجليزي: نشيل Dr و al-/el- (بس من الكلمات الطويلة: Alwareeth → wareeth، و Aliya تظل Aliya)
const skTokens = n => /[a-z]/i.test(n)
  ? String(n).toLowerCase().replace(/\b(dr|doctor|prof|consultant|specialist)\b\.?/g, " ")
    .replace(/\b(abu|abou|abo)\b/g, "abu").replace(/\b(abu|abd|bin|ibn)[\s-]+(?:(el|al|ul)[\s-]+)?(?=[a-z])/g, "$1")   // Abu El Kheir = Abukheir ، Abdel Hamid = Abdhamid
    .split(/[\s\-\/.,]+/).filter(t => t.length > 1).map(t => t.length >= 6 ? t.replace(/^(al|el)(?=...)/, "") : t)
  : docTokens(n);
function nameScore(names, txt) {                                                  // نفس قواعد المطابقة (عربي مباشر + هيكل للإنجليزي) → درجة
  let best = 0;
  for (const [tok, skl, COMMON] of [[docTokens, x => x, DOC_COMMON], [skTokens, skel, SK_COMMON]]) {
    const ot = tok(txt).map(skl).filter(x => x.length >= 2); if (!ot.length) continue;
    const otAll = new Set(ot); for (let i = 0; i < ot.length - 1; i++) otAll.add(ot[i] + ot[i + 1]);
    for (const n of names) {
      const l = tok(n).map(skl).filter(x => x.length >= 2); if (!l.length) continue;
      const want = new Set(l); for (let i = 0; i < l.length - 1; i++) want.add(l[i] + l[i + 1]);
      const hits = [...want].filter(t => otAll.has(t));
      const f = l[0] === ot[0] ? (COMMON.has(ot[0]) ? 1 : 3) : 0;
      const rare = hits.filter(t => !COMMON.has(t) && t.length >= 3 && t !== ot[0]).length;
      const common = hits.filter(t => COMMON.has(t) && t !== ot[0]).length;
      if (f < 3 && !rare) continue;
      best = Math.max(best, f + rare * 2 + common * 0.5);
    }
  }
  return best;
}
export { norm, docTokens, skTokens, skel, nameScore, DOC_COMMON };
