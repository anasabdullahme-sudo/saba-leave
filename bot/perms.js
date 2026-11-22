// (2.20.0) خانة لكل قروب في Railway Variables: وش المسموح للبوت يسويه فيه. أي شي برا القائمة يرفضه حتى لو الذكاء فهمه.
//   GROUP_INFO        قروب الإنفورميشن (الاستقبال)   schedule            = يطبّق تغييرات الجدول (دوام، وقف، موجود، إجازة، زحمة، طبيب جديد…)
//   GROUP_COMPLAINTS  قروب الشكاوي                  prepare,licenses    = يحضّر تغييرات الأطباء الجاية + التراخيص
//                                                    (ممكن تضيف: apply = يطبّق الجدول على طول، complaints/tasks/summary = الشكاوي والمهام وملخص الخميس)
//   GROUP_ECG         قروب ECG                       collect,alerts      = يجمع الصور + تنبيه «صورة بدون رقم»
//   PATIENT_DM        خاص المراجعين                 inquiries           = متابعة طلبات الإجازات
// الكتابة: كلمات بفواصل، مثلاً GROUP_COMPLAINTS=prepare,licenses — و all = كل شي، و off = ولا شي
const DEF = { GROUP_INFO: "schedule", GROUP_COMPLAINTS: "prepare,licenses", GROUP_ECG: "collect,alerts", PATIENT_DM: "inquiries" };
export function can(group, what) {
  const v = String(process.env[group] ?? DEF[group] ?? "").toLowerCase().split(/[,\s،]+/).map(s => s.trim()).filter(Boolean);
  if (v.includes("off")) return false;
  return v.includes("all") || v.includes(what);
}
export const permsText = () => Object.keys(DEF).map(k => `${k}=${process.env[k] ?? DEF[k]}${process.env[k] == null ? " (الافتراضي)" : ""}`).join("\n");
