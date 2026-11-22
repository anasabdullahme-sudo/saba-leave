// (2.10.0) الخاص مع أنس: كل رسالة منه (رد، محوّلة، كلام عادي) تروح للذكاء مع كل السياق
// (جدول الأطباء، حالات اليوم وبكرة، آخر رسايل القروب، الطلبات المنتظرة، آخر كلامنا).
// الذكاء يرد بكلام طبيعي ويقول وش فهم، ويسأل لو مو متأكد، ويطلب «أفعال» لو الشي واضح.
// الكود هو اللي ينفّذ الأفعال، ويقرا التغيير من القاعدة، وبعدها بس يقول «انحفظ».
// القروب ما يتغيّر: ✅ بس.

let A = null;                                   // أدوات group.js (تنمرّر من initBrain)
const chat = [];                                // آخر كلامنا {role: user|model, text, at}
let saveT = null, proposal = null;              // اقتراح ينتظر موافقته
let durQ = null;                                // (2.19.0) تغيير دوام ينتظر «لمدة كم؟»
const EXT = [];                                 // (2.16.0) مساعد قروب الشكاوي (assist.js) + (2.17.0) التراخيص (licenses.js)
export function setAssist(api) { if (api && !EXT.includes(api)) EXT.push(api); }
const AS = { block: () => EXT.map(e => e.block()).join(""), checkAct: a => { for (const e of EXT) { const w = e.checkAct(a); if (w != null) return w; } return null; },
  describeAct: a => { for (const e of EXT) { const x = e.describeAct(a); if (x) return x; } return null; }, act: async a => { for (const e of EXT) { const r = await e.act(a); if (r) return r; } return null; },
  pre: async x => { for (const e of EXT) if (e.pre) { const r = await e.pre(x); if (r) return r; } return null; },          // (2.19.0) رد على سؤال (رجوع من إجازة) قبل الذكاء
  after: async acts => { for (const e of EXT) if (e.after) await e.after(acts).catch(() => {}); } };

export function initBrain(api) {
  A = api;
  A.db.doc("bot/admin_chat").get().then(d => {
    const old = (d.data()?.msgs || []).filter(x => Date.now() - x.at < 24 * 3600e3);
    chat.unshift(...old); chat.sort((a, b) => a.at - b.at); trim();
    proposal = d.data()?.proposal && Date.now() - d.data().proposal.at < 6 * 3600e3 ? d.data().proposal : null;
    durQ = d.data()?.durQ && Date.now() - d.data().durQ.at < 24 * 3600e3 ? d.data().durQ : null;
  }).catch(() => {});
}
const trim = () => { while (chat.length > 24) chat.shift(); };
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => A.db.doc("bot/admin_chat").set({ msgs: chat.slice(-24), proposal: proposal || null, durQ: durQ || null, at: Date.now() }).catch(() => {}), 3000);
}
// كل رسالة تطلع لأنس (تقارير، أسئلة، ردود) تنحفظ في المحادثة عشان الذكاء يعرف وش قال البوت
export function noteOut(text) { chat.push({ role: "model", text: String(text).slice(0, 1500), at: Date.now() }); trim(); persist(); }
function noteIn(text) { chat.push({ role: "user", text: String(text).slice(0, 1500), at: Date.now() }); trim(); persist(); }

/* ---------- السياق ---------- */
const WD = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const dmy = iso => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : "";
const dayName = iso => WD[new Date(iso + "T12:00:00Z").getUTCDay()];
const hh = m => m == null ? "" : `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}${m >= 1440 ? " (اليوم اللي بعده)" : ""}`;
const shiftTxt = sh => (sh || []).map(x => `${hh(x.s)}–${hh(x.e)}${x.e <= x.s ? " (يعدّي نص الليل)" : ""}`).join(" و ") || "—";
const ST_AR = { stop: "وقف استقبال", stop_at: "بيوقف", free: "فاضي", appt: "مواعيد فقط", appt_at: "انتظار لين وقت وبعدها مواعيد", busy: "زحمة", absent: "غير متواجد", late: "متأخر", leaves: "يطلع بدري", starts: "دوام اليوم", present: "موجود" };

function doctorsBlock() {
  return A.docs().map(d => [d.id, A.shortName(d.name), (d.aliases || []).join("/") || "-", d.dep,
    "أيام: " + ((d.workdays || []).map(i => WD[i]).join("،") || "—"), "دوام: " + shiftTxt(d.shifts),
    d.alt?.days?.length ? `دوام ثاني ${d.alt.days.map(i => WD[i]).join("،")}: ${shiftTxt(d.alt.shifts)}` : "",
    d.away && Object.keys(d.away).length ? "في فروع ثانية كل أسبوع: " + Object.entries(d.away).map(([w, b]) => `${WD[+w]} ${b}`).join("، ") : "",
    d.room ? "غرفة " + d.room : "", d.fee ? "كشفية " + d.fee : ""].filter(Boolean).join(" | ")).join("\n");
}
// (2.17.2) التغييرات يوم يوم (اليوم + 9 أيام) — عشان «جهّز لي رسالة تغييرات الجمعة / الأسبوع الجاي» يطلع من بيانات حقيقية
function changesBlock(iso, plans) {
  const b = A.getBoard() || {}, out = [];
  for (let i = 0; i <= 9; i++) {
    const day = A.isoPlus(iso, i), wd = new Date(day + "T12:00:00Z").getUTCDay(), L = [];
    for (const v of b.vacations || []) {
      if (v.start === day) L.push(`يبدأ إجازة: د. ${A.shortName(v.name)}${v.end ? ` (لين ${v.end}، يرجع ${A.isoPlus(v.end, 1)})` : ""}`);
      if (v.end && A.isoPlus(v.end, 1) === day) L.push(`يرجع من الإجازة: د. ${A.shortName(v.name)}`);
      if (v.start < day && (!v.end || v.end >= day) && i === 0) L.push(`في إجازة: د. ${A.shortName(v.name)}`);
    }
    for (const p of plans || []) if (p.date === day) L.push(`خطة: ${p.text || p.summary || JSON.stringify(p).slice(0, 160)}`);
    for (const x of b.awayDays || []) if (x.date === day) L.push(`في فرع ثاني: د. ${A.shortName(docOf(x.doctorId)?.name || x.doctorId)} (${x.branch})`);
    const working = A.docs().filter(d => (d.workdays || []).includes(wd) && !(b.vacations || []).some(v => v.doctorId === d.id && v.start <= day && (!v.end || v.end >= day)));
    if (wd === 5 || L.length) L.push(`يداومون (حسب الجدول): ${working.map(d => `${A.shortName(d.name)} ${shiftTxt(d.alt?.days?.includes(wd) ? d.alt.shifts : d.shifts)}`).join("، ") || "—"}`);
    if (L.length) out.push(`${dayName(day)} ${day}:\n  ${L.join("\n  ")}`);
  }
  return out.join("\n") || "—";
}
function vacBlock(iso) {
  return (A.getBoard()?.vacations || []).filter(v => !v.end || v.end >= iso).map(v => `${A.shortName(v.name)} (${v.doctorId}): ${v.start} → ${v.end || "مفتوحة"}`).join("\n") || "—";
}
function todayBlock(iso) {
  const t = A.getToday(); if (!t || t.date !== iso) return "— ما فيه حالات اليوم";
  const nm = id => { const d = A.docs().find(x => x.id === id); return d ? `${A.shortName(d.name)} (${id})` : id; };
  const st = Object.entries(t.st || {}).map(([k, v]) => `${nm(k)}: ${ST_AR[v.kind] || v.kind}${v.off ? " (خلص دوامه)" : ""}${v.from != null ? " من " + hh(v.from) : ""}${v.until != null ? " لين " + hh(v.until) : ""}${v.apptFrom != null ? " ومواعيد فقط من " + hh(v.apptFrom) : ""} — ${v.by || ""}`);
  const sc = (t.scheduled || []).map(s => `مجدول ${hh(s.min)}: ${nm(s.key)} → ${s.kind === "off" ? "خلص دوامه" : s.kind === "appt" ? "مواعيد فقط" : "وقف"}`);
  return [...st, ...sc].join("\n") || "— ما فيه حالات اليوم";
}
function planBlock(items) {
  const nm = id => { const d = A.docs().find(x => x.id === id); return d ? `${A.shortName(d.name)} (${id})` : id; };
  return items.map(i => `${i.date} ${dayName(i.date)}: ${nm(i.doctorId)} — ${i.kind === "set_schedule" ? "دوام ثابت جديد" : i.kind === "remove_doctor" ? "يتشال من الجدول" : i.kind}${i.at_min != null ? " من " + hh(i.at_min) : i.at_time ? " من " + i.at_time : ""}${i.until_min != null ? " لين " + hh(i.until_min) : i.until_time ? " لين " + i.until_time : ""} (${i.by || ""})`).join("\n") || "—";
}
function pendingBlock(docsP, clar) {
  const a = docsP.map(i => `#${i.code} طبيب جديد ينتظر موافقتك: ${i.name} | ${i.dept || "—"} | أيام ${(i.days || []).map(x => WD[x]).join("،") || "—"} | ${shiftTxt(i.shifts)} | من رسالة ${i.by}: «${String(i.text || "").slice(0, 160)}»`);
  const b = clar.map(i => `#${i.code} ${i.report ? "تقرير" : i.opts ? "خيارات تغيير دوام" : i.hours ? "سؤال «من كم لكم دوامه اليوم» عن " + i.hours.name : i.remove ? "يشيل د. " + i.remove.name + "؟" : "رسالة قروب ما انفهمت"} — ${i.by}: «${String(i.text || "").slice(0, 200)}»${i.opts ? "\n   " + i.opts.map((o, n) => `${n + 1}) ${o.label}`).join("\n   ") : ""}${i.key?.id ? " [لها ✅ في القروب]" : ""}`);
  return [...a, ...b].join("\n") || "—";
}
function groupBlock() {
  return A.groupLog().filter(g => Date.now() - g.at < 36 * 3600e3).slice(-20).map(g => {
    const t = new Date(g.at).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
    return `[${t}] ${g.by}: «${g.text.slice(0, 300)}» → ${g.res}`;
  }).join("\n") || "—";
}

const RULES = `أنت مساعد أنس (مشرف عيادات سابا — فرع البوادي، جدة) على الواتساب الخاص. تدير صفحة أطباء البوادي (الجدول + حالات اليوم) اللي الاستقبال والأداة يشوفونها.
تكلّم باللهجة السعودية، بطبيعية واختصار (سطرين لخمسة)، كأنك زميل فاهم. بدون مقدمات ولا إيموجي كثير.

(2.17.2) «جهّز لي رسالة …» (تغييرات الجمعة، تغييرات الأسبوع الجاي، دوام يوم، تعميم، تذكير، رد على المدير):
- اكتب الرسالة كاملة جاهزة للنسخ في reply على طول — لا تقول «بجهّز» ولا «أبشر بجهزها» وتسكت. الطول هنا مو مشكلة.
- خذ المعلومات من «التغييرات يوم يوم» و«الإجازات» و«الخطط» و«حالات اليوم» و«الجدول» و«قروب الشكاوي» (آخر رسايله) — لا تخترع. اكتب الرسالة بأسلوب رسمي مختصر (تحية سطر، بعدها النقاط: اليوم والتاريخ ← الطبيب ← التغيير)، واللي ما تأكدت منه قل لأنس تحت الرسالة.
- لو أنس قال «عدّل/ضيف/شيل/غيّر …» بعد رسالة جهزتها → رجّع الرسالة كاملة بعد التعديل (مو الجزء المعدّل بس).
- «أرسلها في القروب» بعد رسالة جاهزة → group_send: text = الرسالة كاملة كما هي.
- الرسالة الجاهزة ما تحتاج actions (إلا group_send لما يطلب الإرسال).
- (2.19.4) الأوقات بنظام 12 ساعة دايم في كل ردودك والرسايل الجاهزة: «11ص – 2م»، «5:30م – 10:30م»، «9م – 9ص» — لا تكتب 14:00 ولا 22:30 أبداً (إلا داخل actions).
- تغيير تطبّقه الحين (actions) وتحطه في رسالة جاهزة بنفس الرد: اكتبه زي ما طلب أنس بالضبط؛ والنظام يحط تنبيه فوق الرسالة لو ما انطبق.

كيف تشتغل:
- (2.16.1) أول شي اكتب في understood كلامه بصياغتك أنت، واضحة ومرتبة: كل طبيب لحاله (اسمه الكامل من الجدول) ← وش المطلوب ← اليوم بالتاريخ YYYY-MM-DD ← الوقت HH:MM.
  أنس يكتب بسرعة: أخطاء إملائية («اكرا» = إكرامي، «الوزري» = الوزيري)، بدون فواصل، كلمات ناقصة، ترتيب ملخبط، مصري أو سعودي، كلام فويس. أعد قراءة الجملة أكثر من مرة واربطها بالرسالة اللي يرد عليها وباللي قبلها لين تفهم وش يبي.
  «خلها ثابتة / نفسها كل يوم / مثل امس» = خذ الأوقات من الرسالة اللي يرد عليها أو من آخر شي انحكى عن نفس الطبيب.
  بعدها actions تطابق understood بالضبط: كل طبيب في understood له فعله بكل حقوله (ما تنسى end_date ولا end_time).
- افهم قصده من كلامه ومن السياق كله: المحادثة، الرسالة اللي يرد عليها، رسايل القروب الأخيرة، الطلبات المنتظرة، والجدول.
- في reply قل وش فهمت بالضبط (الطبيب، اليوم والتاريخ، الوقت) ووش بتسوي — بصيغة المستقبل («بعدّل…»، «بحط…»)، مو الماضي، لأن التنفيذ يصير بعد ردك.
- قبل أي فعل شيك على حالات اليوم والخطط والجدول: لو الشي المطلوب موجود أصلاً قل له إنه موجود وبدون أفعال.
- «فقط/بس السبت» أو «هذا السبت» أو يوم معيّن بدون «كل/دائم/ثابت» = يوم واحد (status)، مو دوام ثابت.
- الشي واضح؟ حط الأفعال في actions وطبّق على طول. مو متأكد من شي يغيّر النتيجة (مين الطبيب، أي يوم، الوقت)؟ اسأله سؤال واحد واضح و actions فاضية.
- (2.19.0) مدة تغيير الدوام: لو قال يوم معيّن (اليوم/بكرة/الإثنين) بدون ثابت → status. لكن «بداية من / ابتداءً من / اعتباراً من / من يوم الإثنين …» = بداية تغيير (schedule مع start_date)، مو يوم واحد. لو قال ثابت/دائم/كل يوم → schedule بدون end_date. لو قال مدة → schedule مع end_date (آخر يوم بالمؤقت: «أسبوع» من البداية = البداية+6، «3 أيام» = البداية+2، «لين 30/11» = 2026-11-30، «من الأحد لين الخميس» = start_date الأحد و end_date الخميس) أو until_return_of = doctor_id الطبيب اللي «لين يرجع/ترجع من إجازته». بعد المؤقت يرجع لدوامه الثابت لحاله.
  ما قال مدة أبداً («د سارة من 5 لين 1»، «سيتم تغيير شفتها»)؟ لا تسأل أنت ولا تختار — حط schedule بدون end_date (و start_date لو قال «بداية من …») والنظام يسأله عن المدة بخيارات.
- دوام بفترتين («من 11ص لين 2م و من 5:30م لين 10:30م»، «شفتين من ١١ ص الى ٢ م ومن ٥:٣٠ م الى ١٠:٣٠») → shifts فيها الفترتين كل وحدة start_time و end_time (مو فترة وحدة). وقت بدون ص/م بعد وقت مسائي بنفس الفترة = مسائي (٥:٣٠م الى ١٠:٣٠ = 17:30–22:30).
- until_return_of = طبيب ثاني عليه إجازة (اللي الدوام يغطي مكانه) — مو نفس الطبيب أبداً. لو أنس ما قال «لين يرجع/ترجع فلان» لا تحطها. نفس دوامه المسجّل بالضبط؟ قل «نفس دوامه» وبدون أفعال.
- «فلان نفس دوامه / بشفته الطبيعي» = ما يتغيّر شي (إلا لو هو في إجازة ويرجع → end_vacation).
- تغيير كبير (دوام ثابت، إضافة/حذف طبيب، تراجع) وأنت فاهمه من كلامه الصريح → طبّق. لو فاهمه من استنتاجك أو من رسالة قروب محوّلة بس → confirm_first = true و actions = اللي بتسويه، واسأله «أطبّق؟».
- لو عندك «اقتراح ينتظر موافقته» ووافق («ايوه/طبق/تمام») → use_proposal = true. لو عدّل عليه → اكتب الأفعال الجديدة كاملة.
- سؤال (متى دوامه؟ ليش سويت كذا؟ وش صار؟) → جاوب من البيانات بس، بدون أفعال. لو أخطأت قبل، اعترف بجملة واقترح التصحيح.
- تصحيح لشي انحفظ غلط → صحّح الحالة النهائية كاملة (مثلاً: ألغِ الخطة الغلط بـ cancel_plan، وحط الصح).
- رسالة محوّلة من القروب = كلام الاستقبال؛ افهمها زي رسالة قروب وطبّق اللي فيها (التغييرات اليومية على طول، الدائمة بتأكيد).
- لا تكتب أبداً «انحفظ» أو «تم» أو «حفظت» أو ✅ — النظام يقرا الموقع بعد التنفيذ ويضيف النتيجة بنفسه.
- لا تخترع أوقات أو أيام أو أرقام ما انقالت. الأوقات بصيغة 24 ساعة HH:MM. في العيادة 1–7 بدون ص/م غالباً مساءً، و8–11 حسب دوام الطبيب.
- الدوام اللي يعدّي نص الليل (مثل 5 العصر لين 9 الصبح): date = يوم البداية، start_time = 17:00، end_time = 09:00، و until_next_day = true. لا تحطه على اليوم اللي بعده.
- بعد 12 بالليل ولين 5 الفجر، «بكرة» و«الليلة» ممكن تعني يومين — لو ما وضّح اسأل باسم اليوم.
- status و cancel_plan لازم فيها date دايم (YYYY-MM-DD). رسالة فيها «دوام يوم الجمعة» أو «بكرة» → date = ذاك اليوم بالضبط، مو اليوم. التواريخ مكتوبة تحت عند «الحين» و«الأيام الجاية».
- لا تكرر نفس الفعل مرتين. ولو نفس الدوام محفوظ أصلاً في الخطط (من القروب) قل «موجود من قبل» وبدون أفعال.
- لا تضيف طبيب ما انذكر في القروب أو ما طلبه أنس صراحة.

الأفعال (type):
كل الأوقات في start_time / end_time / at_time بصيغة "HH:MM" أرقام إنجليزية 24 ساعة (مثل "12:00" و "20:00") — لا تحطها في reply بس، لازم في الحقول.
- status: حالة ليوم واحد (اليوم أو يوم جاي خلال أسبوعين). kind واحد من: starts_at (دوام ذاك اليوم: start_time و end_time — الاثنين لازم)، present (موجود، end_time اختياري)، leaves_at (يطلع الساعة end_time)، late (يوصل الساعة at_time أو delay_minutes)، stop (وقف استقبال، at_time لو بوقت جاي)، free، appointments_only (at_time = من متى مواعيد فقط)، busy، absent_today (غير متواجد ذاك اليوم)، clear (يشيل حالة اليوم ويرجع لجدوله). date = YYYY-MM-DD.
- cancel_plan: يلغي كل الخطط المحفوظة لطبيب في date.
- schedule: دوام ثابت أو مؤقت (start_time و end_time، أو shifts لو أكثر من فترة). mode = all_days (كل أيامه صارت هالوقت) / only_days (الأيام days بس بدوام مختلف، الباقي زي ما هو) / set_days (أيام دوامه صارت days بهالوقت). start_date لو يبدأ يوم جاي. مؤقت: end_date (آخر يوم) أو until_return_of (doctor_id).
- info: room / ext / fee.
- vacation: start_date و end_date (آخر يوم إجازة).
- end_vacation: return_date = يوم المباشرة.
- add_doctor: name, dept (لازم قسم من أقسام الجدول — لو ما تعرفه اسأل قبل ما تضيف)، days, start_time, end_time, room, ext, fee.
- move_doctor: doctor_id + dept — ينقل الطبيب لقسم ثاني.
- remove_doctor: doctor_id (و start_date لو من يوم جاي) — يشيل الطبيب من الجدول كله نهائياً. بس لو أنس قال صراحة إنه ترك/ما عاد يداوم في البوادي. «شيله يوم الإثنين» مو حذف: هذا schedule (set_days) أو branch_day. والنظام دايم يسأله قبل الحذف.
- restore_doctor: doctor_id — يرجّع طبيب انشال (من «أطباء انشالوا مؤخراً») لقسمه بدوامه.
- branch_day: doctor_id + branch (اسم الفرع مثل الصفا، السليمانية) — الطبيب يكون في فرع ثاني: days = أيام الأسبوع (دائم كل أسبوع) أو date = YYYY-MM-DD (يوم واحد). clear = true يشيلها. لو أنس ما قال يوم واحد ولا دائم → اسأله.
- alias: doctor_id + alias (اسم ثاني يكتبونه في القروب).
- remove_alias: doctor_id + alias — يشيل اسم ثاني انحفظ غلط (مثل اسم طبيب ثاني انربط فيه).
- رسالة «صورة إجازة من الموارد البشرية» فيها «مو في جدول الأطباء» وأنس قال مين الطبيب → vacation بنفس التواريخ (start_date/end_date) + alias بالاسم الإنجليزي من الرسالة.
- طبيب مو في الجدول؟ شيك على «أطباء انشالوا مؤخراً» قبل ما تقول «مو موجود» — ولو انشال بالغلط قل له الصدق واقترح restore_doctor.
- لا توعد بشي ما تسويه الأفعال («ما راح أربط…»): لو فيه ربط غلط شيله بـ remove_alias.
- pending_doctor: code + decision (approve/reject)، وتقدر تعدّل dept/days/start_time/end_time/room/fee قبل الإضافة.
- option: code + n (رقم خيار من رسالة الخيارات).
- resolve: code — يقفل سؤال/رسالة قروب منتظرة (ويحط ✅ على رسالتها في القروب بعد ما ينحفظ). حطه مع أفعال التصحيح، أو لحاله لو قال «تجاهلها».
- undo: يرجّع الجدول الثابت للنسخة اللي قبل آخر تعديل.
- reports: on = true/false (تقارير القروب له).
doctor_id لازم من الجدول تحت.

قروب الشكاوي (البوت يقراه ويتابع الشكاوي والطلبات — تحت «شكاوي هالأسبوع» و«طلبات تنتظر أنس»):
- رسالة تبدأ بـ «[من قروب الشكاوي — …]» = طلب وصل من القروب (غالباً المدير)، مو كلام أنس: طبّق تغييرات الجدول اللي ليوم أو أيام محددة (إجازة، مرضية، غياب، تغطية، تأخير) على طول، والدائمة confirm_first. وفي reply قل لأنس باختصار وش بتسجّل.
- أنس قال إن شكوى انحلت («شكوى فلانة انحلت، كلمناها…») → complaint_resolve: code (#C…) + how = كيف انحلت بكلامه. مو متأكد أي شكوى؟ اسأله وعدّد له المفتوحة.
- رسالة محوّلة فيها شكوى مراجع (من الخاص أو مكان ثاني) أو أنس قال «سجّل شكوى…» → complaint_add: text = الشكوى بجملة واضحة، name = مين نقلها، patient و about لو معروفة، how لو قال إنها انحلت. (رسالة محوّلة عن دوام الأطباء تبقى زي ما هي فوق.)
- «أرسل» / «أرسلها» / «تمام أرسل» بعد رسالة جاهزة (#T) → task_send: code (آخر #T فيه رسالة جاهزة لو ما حدد)، و text = النص بعد تعديله لو طلب تعديل (اكتب النص كامل). البوت يرسلها في قروب الشكاوي ردّاً على رسالة الطلب.
- «خلصت» / «سويتها» عن طلب #T → task_done (code + how لو قال كيف). «لا تسويها / انسه» → task_drop.
- «وش الشكاوي / ملخص الشكاوي» → complaints_summary.
- لا تقول إن الشكوى انحلت أو الرسالة انرسلت إلا بفعل.

تراخيص الممارسين (تحت «تراخيص الممارسين» — أنس يرسل ملفات PDF والبوت يقراها؛ كل ترخيص يدخل آخر شهرين ينرسل عنه مرة وحدة في قروب الشكاوي):
- «ترخيص فلان تجدد لين …» → license_renew: code (#L…) لو موجود في القائمة أو name = اسمه، و end_date = تاريخ الانتهاء الجديد YYYY-MM-DD.
- «وش التراخيص اللي بتنتهي / مين ترخيصه قرب» → license_list.
- «فلان ترخيصه بالحرمين / بالزهراء (تالا) / بصفا (وطنك) / بالسليمانية / بالبوادي» → license_branch: name = اسم الطبيب، branch = اسم الفرع (الزهراء = تالا، صفا = وطنك). أسماء الفروع لأنس: البوادي، الحرمين، صفا، السليمانية، الزهراء. (كل طبيب ترخيص واحد في فرع واحد؛ يتحدّث في موقع الإجازات.)
- «مين باقي ما عنده ترخيص / مين ماعندك ترخيصه / مين ناقص ترخيصه / الدكاترة اللي ما رسلت ترخيصهم» → license_missing (مو license_list — هذا عن اللي ما وصل ترخيصهم أصلاً).`;

const SCHEMA = { type: "OBJECT", properties: {
  understood: { type: "STRING" },
  reply: { type: "STRING" }, confirm_first: { type: "BOOLEAN" }, use_proposal: { type: "BOOLEAN" },
  actions: { type: "ARRAY", items: { type: "OBJECT", properties: {
    type: { type: "STRING", enum: ["status", "cancel_plan", "schedule", "info", "vacation", "end_vacation", "add_doctor", "move_doctor", "remove_doctor", "restore_doctor", "branch_day", "alias", "remove_alias", "pending_doctor", "option", "resolve", "undo", "reports", "complaint_add", "complaint_resolve", "complaint_reopen", "task_send", "task_done", "task_drop", "complaints_summary", "license_renew", "license_list", "license_missing", "license_branch", "group_send", "friday_unit", "friday_draft"] },
    text: { type: "STRING" }, how: { type: "STRING" }, patient: { type: "STRING" }, about: { type: "STRING" },
    doctor_id: { type: "STRING" }, kind: { type: "STRING" }, date: { type: "STRING" },
    start_time: { type: "STRING" }, end_time: { type: "STRING" }, until_next_day: { type: "BOOLEAN" }, at_time: { type: "STRING" }, delay_minutes: { type: "INTEGER" },
    mode: { type: "STRING" }, days: { type: "ARRAY", items: { type: "INTEGER" } }, start_date: { type: "STRING" }, end_date: { type: "STRING" }, return_date: { type: "STRING" },
    name: { type: "STRING" }, dept: { type: "STRING" }, room: { type: "STRING" }, ext: { type: "STRING" }, fee: { type: "STRING" }, alias: { type: "STRING" },
    branch: { type: "STRING" }, clear: { type: "BOOLEAN" }, code: { type: "STRING" }, decision: { type: "STRING" }, n: { type: "INTEGER" }, on: { type: "BOOLEAN" },
    shifts: { type: "ARRAY", items: { type: "OBJECT", properties: { start_time: { type: "STRING" }, end_time: { type: "STRING" } } } }, until_return_of: { type: "STRING" } }, required: ["type"] } } },
  required: ["understood", "reply"], propertyOrdering: ["understood", "reply", "confirm_first", "use_proposal", "actions"] };

async function callAI(system, contents, { models, temp = 0.3 } = {}) {
  for (const model of models || A.models) {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 60000);
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": A.gemini }, signal: ctl.signal,
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: temp, maxOutputTokens: 8192, responseMimeType: "application/json", responseSchema: SCHEMA } }) });
      clearTimeout(tm);
      if (!res.ok) { A.log.warn({ model, status: res.status }, "Gemini الخاص"); continue; }
      const j = await res.json(), txt = (j?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
      const out = JSON.parse(txt || "{}");
      if (typeof out.reply !== "string") continue;
      out.__model = model;
      return out;
    } catch (e) { A.log.warn({ model, err: String(e?.message || e) }, "Gemini الخاص"); }
  }
  return null;
}

/* ---------- الرسالة من أنس ---------- */
async function buildCtx() {
  const t = A.nowR(), tomorrow = A.isoPlus(t.iso, 1);
  const [planD, pdD, pcD, rmD] = await Promise.all([A.db.doc("board/bawadi_plan").get(), A.db.doc("bot/pending_doctors").get(), A.db.doc("bot/pending_clarify").get(), A.db.doc("bot/removed_doctors").get()]);
  const removed = (rmD.data()?.items || []).filter(x => Date.now() - x.at < 30 * 864e5);
  const plans = (planD.data()?.items || []).filter(i => i.date >= t.iso).sort((a, b) => a.date.localeCompare(b.date));
  const pdocs = (pdD.data()?.items || []).filter(i => Date.now() - i.at < 7 * 864e5);
  const pclar = (pcD.data()?.items || []).filter(i => Date.now() - i.at < 12 * 3600e3);
  const night = t.m < 300 ? `\nملاحظة: الساعة الحين بعد 12 بالليل — «اليوم» بدأ للتو (${dayName(t.iso)})، واللي قبله ${dayName(A.isoPlus(t.iso, -1))}.` : "";
  const system = RULES + `\n\nالحين: ${dayName(t.iso)} ${t.iso} الساعة ${hh(t.m)} (بكرة ${dayName(tomorrow)} ${tomorrow}).${night}
الأيام الجاية: ${[2, 3, 4, 5, 6].map(i => dayName(A.isoPlus(t.iso, i)) + " " + A.isoPlus(t.iso, i)).join("، ")}
\n## جدول أطباء البوادي (id | الاسم | أسماء ثانية | القسم | الأيام | الدوام | …)\n${doctorsBlock()}
\n## الإجازات (الحالية والجاية)\n${vacBlock(t.iso)}
\n## التغييرات يوم يوم (للرسايل)\n${changesBlock(t.iso, plans)}
\n## حالات اليوم ${t.iso} (على الموقع والأداة الحين)\n${todayBlock(t.iso)}
\n## خطط محفوظة لأيام جاية (تنطبق أول يومها)\n${planBlock(plans)}
\n## طلبات تنتظر أنس\n${pendingBlock(pdocs, pclar)}
\n## آخر رسايل القروب (وش سوى البوت فيها)\n${groupBlock()}
\n## أطباء انشالوا مؤخراً من الجدول (id | الاسم | القسم | متى | مين)\n${removed.map(x => `${x.doc.id} | ${A.shortName(x.doc.name)} | ${x.dep.name} | ${new Date(x.at).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })} | ${x.by}`).join("\n") || "—"}
\n## أيام في فروع ثانية (يوم واحد)\n${(A.getBoard()?.awayDays || []).filter(x => x.date >= t.iso).map(x => `${A.shortName(docOf(x.doctorId)?.name || x.doctorId)}: ${x.date} في ${x.branch}`).join("\n") || "—"}
\n## اقتراح ينتظر موافقته\n${proposal ? proposal.summary : "—"}${AS ? AS.block() : ""}`;
  return { system, plans, pdocs, pclar };
}
// الأفعال من رد الذكاء + تعبئة الناقص من الكلام نفسه (الرسالة المقتبسة، ردّه، وفهمه)
function prepActs(o, txt, quoted) {
  const R = [o.understood, o.reply].filter(Boolean).join("\n"), T2 = [quoted, txt].filter(Boolean).join("\n");
  return uniq((Array.isArray(o.actions) ? o.actions : []).map(normA).map(a => fillDept(a, o.reply, txt)).map((a, i, all) => fillTimes(a, R, T2, all.filter(NEEDS_T).length > 1)).map(a => fillShifts(a, T2, R)).map(a => fillBack(a)).map(a => fillVac(a, R, T2)).map(a => fillDate(a, o.reply, txt)));
}

export async function handle(m, text, { forwarded = false } = {}) {
  if (!A?.gemini) return false;
  const ci = m.message?.extendedTextMessage?.contextInfo || {};
  const q = ci.quotedMessage, quoted = (q?.conversation || q?.extendedTextMessage?.text || q?.imageMessage?.caption || "").trim();
  const user = (forwarded ? "[رسالة محوّلة من قروب الاستقبال]\n" : "") + (quoted ? `[يرد على: «${quoted.slice(0, 2500)}»]\n` : "") + text;
  // (2.19.0) جواب على سؤال جاهز (المدة، الرجوع من الإجازة) → بدون الذكاء
  if (!forwarded) {
    const pr = await AS.pre({ text, quoted, lastOut: lastModel() }).catch(e => { A.log.warn({ err: String(e?.message || e) }, "رد سؤال"); return null; });
    if (pr) { noteIn(user); await A.dmAdmin(pr.msg || "تمام."); return true; }
    const dq = await durPre(text, quoted).catch(e => { A.log.warn({ err: String(e?.message || e) }, "رد المدة"); return null; });
    if (dq) { noteIn(user); await A.dmAdmin(dq); return true; }
  }
  const { system, pdocs, pclar } = await buildCtx();
  const hist = chat.filter(x => Date.now() - x.at < 24 * 3600e3).slice(-16).map(x => ({ role: x.role, parts: [{ text: x.text }] }));
  while (hist.length && hist[0].role !== "user") hist.shift();
  const contents = []; for (const h of hist) { if (contents.length && contents[contents.length - 1].role === h.role) contents[contents.length - 1].parts[0].text += "\n" + h.parts[0].text; else contents.push(h); }
  if (contents.length && contents[contents.length - 1].role === "user") contents[contents.length - 1].parts[0].text += "\n" + user; else contents.push({ role: "user", parts: [{ text: user }] });
  const sock = A.getSock(), jid = m.key?.remoteJid;
  try { if (jid) await sock?.sendPresenceUpdate("composing", jid); } catch {}
  let out = await callAI(system, contents);
  try { if (jid) sock?.sendPresenceUpdate("paused", jid); } catch {}
  if (!out) return false;                                        // الذكاء ما رد → group.js يكمل بالطريقة القديمة
  noteIn(user);
  const prep = (o, txt) => prepActs(o, txt, quoted);
  let actions = prep(out, text);
  // فعل ناقص (حقول ما تعبّت) → نرجع للذكاء مرة وحدة يكمّله بدل ما نقول «ما طبّقت»
  const miss = actions.map(a => [a, check(a)]).filter(([, w]) => w);
  if (miss.length && !out.use_proposal) {
    const fix = await callAI(system, [...contents, { role: "model", parts: [{ text: JSON.stringify({ reply: out.reply, actions: out.actions }) }] },
      { role: "user", parts: [{ text: "[النظام] الأفعال هذي ناقصة وما تنفع:\n" + miss.map(([a, w]) => `- ${a.type}: ${w}`).join("\n") + "\nرجّع نفس الرد مع actions كاملة: كل فعل فيه حقوله المطلوبة بالضبط (status: doctor_id, kind, date, start_time/end_time أو at_time حسب النوع — move_doctor: doctor_id و dept باسم قسم من الجدول — add_doctor: name و dept …). لو فعلاً ناقصك معلومة من أنس، اسأله و actions فاضية." }] }]).catch(() => null);
    let fa = fix ? prep(fix, text) : null;
    if (fix && (!fa.length || !fa.some(a => check(a)))) { blog(user, out); out = fix; actions = fa; }
    else {                                                                     // (2.16.1) محاولة ثالثة: نعيد صياغة الطلب خطوة خطوة، بموديل ثاني وحرارة صفر
      const miss2 = (fa || actions).map(a => [a, check(a)]).filter(([, w]) => w);
      const fix2 = await callAI(system, [...contents, { role: "model", parts: [{ text: JSON.stringify({ understood: (fix || out).understood, reply: (fix || out).reply, actions: (fix || out).actions }) }] },
        { role: "user", parts: [{ text: "[النظام] لسى ناقص:\n" + miss2.map(([a, w]) => `- ${a.type}: ${w}`).join("\n") + "\nأعد قراءة كلام أنس والرسالة اللي يرد عليها كلمة كلمة. اكتب understood من جديد: كل طبيب ← المطلوب ← التاريخ YYYY-MM-DD ← الوقت HH:MM (التواريخ والأوقات موجودة في الكلام أو في الرسالة المقتبسة أو في ردك أنت). بعدها actions كاملة. لو فعلاً المعلومة مو موجودة في أي مكان: اسأله سؤال واحد واضح عن الناقص بس، و actions فاضية." }] }],
        { models: [...A.models].reverse(), temp: 0 }).catch(() => null);
      if (fix2) { const f2 = prep(fix2, text); if (!f2.length || f2.filter(a => check(a)).length < miss2.length) { blog(user, out); out = fix2; actions = f2; } }
    }
  }
  blog(user, out);
  if (out.use_proposal && proposal?.actions?.length && !actions.length) actions = proposal.actions;
  let reply = String(out.reply || "").split("\n").filter(l => !/✅|انحفظ|حفظته|تم الحفظ/.test(l)).join("\n").trim();
  if (actions.length) for (const [a, b] of TENSE) reply = reply.replace(a, b);   // التنفيذ بعد الرد — ما نقول «عدّلت» قبل ما ينحفظ
  if (actions.some(a => a.type === "remove_doctor") && !out.use_proposal) out.confirm_first = true;   // (2.13.0) الحذف دايم بتأكيد
  // (2.19.0) تغيير دوام بدون مدة (لا ثابت ولا يوم ولا مدة) → نسأله «لمدة كم؟» بخيارات بدل ما نطبّقه ثابت
  let held = [];
  if (!out.use_proposal) {
    const ctxT = nn([quoted, text, ...chat.filter(x => x.role === "user" && Date.now() - x.at < 20 * 60e3).slice(-3).map(x => x.text)].join("\n"));
    const dur = durOf(text, null);
    actions = actions.map(a => {
      if (a.type !== "schedule" || a.mode === "only_days" || ISO(a.end_date) || a.until_return_of || check(a)) return a;
      if (dur) return { ...a, ...(dur.start && !ISO(a.start_date) ? { start_date: dur.start } : {}), ...(dur.until ? { end_date: dur.until } : {}), ...(dur.back ? { until_return_of: dur.back } : {}) };
      const d = docOf(a.doctor_id);
      if (PERMW.test(ctxT) || (d && !d.tmp && sameSh(shiftsOf(a), d.shifts))) return a;
      held.push(a); return null;
    }).filter(Boolean);
  }
  if (out.confirm_first && actions.length && !out.use_proposal) {
    const bad = actions.map(a => check(a)).filter(Boolean);
    if (bad.length) { await A.dmAdmin(`${reply}\n\n⚠️ ${bad.join("\n⚠️ ")}`); return true; }
    proposal = { at: Date.now(), actions, summary: actions.map(describe).join("\n") }; persist();
    await A.dmAdmin(`${reply}\n\nاللي بسويه لو وافقت:\n${proposal.summary}`);
    return true;
  }
  const ask = held.length ? askDurText(held) : "";
  if (!actions.length) { await A.dmAdmin([reply || (ask ? "" : "تمام."), ask].filter(Boolean).join("\n\n")); return true; }
  proposal = null; persist();
  const lines = await execute(actions, pclar, pdocs);
  // (2.19.4) رسالة جاهزة + فعل ما انطبق → تنبيه فوق الرسالة (عشان ما تنسخ تغيير ما صار)
  const bad = lines.filter(l => /^(⚠️ ما طبّقت|❌)/.test(String(l).trim()));
  const warn = bad.length && String(reply).length > 150 && /السلام عليكم|جاهز|للنسخ|تعميم|تنبيهات|تغييرات/.test(reply) ? `⚠️ انتبه: الرسالة الجاهزة تحت فيها تغيير ما انطبق — لا تنسخها قبل ما تعدّله:\n${bad.map(l => "• " + String(l).replace(/^(⚠️ ما طبّقت: |❌ )/, "")).join("\n")}` : "";
  await A.dmAdmin([warn, reply, lines.join("\n"), ask].filter(Boolean).join("\n\n"));
  await AS.after(actions);
  return true;
}
const lastModel = () => [...chat].reverse().find(x => x.role === "model")?.text || "";

/* ---------- (2.19.0) «لمدة كم؟» ---------- */
const nn = s => lat(String(s || "")).replace(/[ً-ْ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();
const PERMW = /ثابت|دائم|دايم|كل يوم|كل الايام|كل ايام|على طول|من الحين وطالع|من اليوم وطالع|بشكل دائم|المعتاد|نهائي|للايام القادمه|الايام الجايه|الايام القادمه/;
const WDW = [["احد", 0], ["اثنين", 1], ["ثلاثا", 2], ["اربعا", 3], ["خميس", 4], ["جمع", 5], ["سبت", 6]];
const wdW = w => (WDW.find(([k]) => String(w || "").includes(k)) || [])[1];
const nextOn = (wd, from) => A.isoPlus(from, (wd - new Date(from + "T12:00:00Z").getUTCDay() + 7) % 7);
// المدة من كلام أنس → { start?, until? } أو { back } (لين يرجع د. فلان)
function durOf(text, start) {
  const s = nn(text); let m;
  if ((m = /(لين|الين|الى|حتى|لغايه|لحد|ل)\s*(ما\s+)?(يرجع|ترجع|رجوع|عوده|يجي|تجي|يباشر|تباشر)\s+(من\s+\S+\s+)?(د\.?\s*|دكتور\S*\s+)?([\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+)?)/.exec(s))) {
    const w = m[6].replace(/\s+(من|بعد|من اجازته|من اجازتها)$/, "");
    const d = findDocLoose(w) || findDocLoose(w.split(" ")[0]); if (d) return { back: d.id };
  }
  const base = start || A.nowR().iso;
  if (/(^|\s)اسبوعين/.test(s)) return { until: A.isoPlus(base, 13) };
  if (/(^|\s)(لمده\s+)?اسبوع(\s|$)/.test(s)) return { until: A.isoPlus(base, 6) };
  if (/(^|\s)(لمده\s+)?شهر(\s|$)/.test(s)) return { until: A.isoPlus(base, 29) };
  if (/(^|\s)يومين(\s|$)/.test(s)) return { until: A.isoPlus(base, 1) };
  if ((m = /(?<![\d\/:.-])(\d{1,2})\s*(ايام|يوم)(\s|$)/.exec(s)) && +m[1] > 0 && +m[1] <= 60) return { until: A.isoPlus(base, +m[1] - 1) };
  for (const [w, k] of [["ثلاث", 3], ["ثلاثه", 3], ["اربع", 4], ["اربعه", 4], ["خمس", 5], ["خمسه", 5], ["ست", 6], ["سته", 6], ["سبع", 7], ["سبعه", 7], ["عشر", 10], ["عشره", 10]]) if (new RegExp(`(^|\\s)${w}\\s+(ايام|يوم)`).test(s)) return { until: A.isoPlus(base, k - 1) };
  const ds = [...s.matchAll(/(?<![\d:])(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?(?![\d:])/g)].map(x => toISO(x[0])).filter(Boolean);
  if (ds.length >= 2) return { start: ds[0], until: ds[1] };
  if (ds.length === 1 && /(لين|الين|الى|حتى|لغايه|لحد)\s*(يوم\s+)?(\S+\s+)?\d/.test(s)) return { until: ds[0] };
  if ((m = /من\s+(يوم\s+)?(\S+)\s+(لين|الين|الى|حتى)\s*(يوم\s+)?(\S+)/.exec(s)) && wdW(m[2]) != null && wdW(m[5]) != null) { const st = nextOn(wdW(m[2]), A.nowR().iso); return { start: st, until: nextOn(wdW(m[5]), st) }; }
  if ((m = /(لين|الين|الى|حتى|لغايه|لحد)\s*(يوم\s+)?(\S+)/.exec(s)) && wdW(m[3]) != null) return { until: nextOn(wdW(m[3]), base) };
  if ((m = /(لين|الين|الى|حتى|لغايه|لحد)\s*(\d{1,2}\s+[\u0600-\u06FFa-z]+)/.exec(s))) { const v = toISO(m[2]); if (v) return { until: v }; }
  return null;
}
function askDurText(acts) {
  const t = A.nowR(), start = acts.map(a => ISO(a.start_date) && a.start_date > t.iso ? a.start_date : t.iso).sort()[0];
  const opts = start === t.iso ? [{ k: "one", date: t.iso, label: "اليوم بس" }, { k: "one", date: A.isoPlus(t.iso, 1), label: `بكرة ${dayName(A.isoPlus(t.iso, 1))} بس` }] : [{ k: "one", date: start, label: `${dayName(start)} ${dmy(start)} بس` }];
  opts.push({ k: "perm", label: "ثابت" });
  for (const a of acts) {                                                     // زميل بنفس القسم عليه إجازة → «لين يرجع»
    const d = docOf(a.doctor_id); if (!d) continue;
    for (const mate of A.docs().filter(x => x.id !== d.id && x.dep === d.dep && (A.getBoard()?.vacations || []).some(v => v.doctorId === x.id && v.start <= start && (!v.end || v.end >= start))))
      if (!opts.some(o => o.id === mate.id) && opts.length < 6) opts.push({ k: "back", id: mate.id, label: `لين يرجع د. ${A.shortName(mate.name)} (${backInfo(mate.id)})` });
  }
  durQ = { code: "W" + String(Date.now() % 100).padStart(2, "0"), at: Date.now(), acts, start, opts }; persist();
  const nums = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];
  return [`⏳ لمدة كم؟  #${durQ.code}`, ...acts.map(a => describe(a).replace("دوام ثابت", "دوام")), ...opts.map((o, i) => `${nums[i]} ${o.label}${acts.length > 1 ? " (للكل)" : ""}`), "أو اكتب المدة: أسبوع / 3 أيام / لين 30/11 / من الأحد لين الخميس / لين يرجع د. فلان"].join("\n");
}
// الأفعال بعد ما عرفنا المدة
function withDur(acts, o, dur) {
  return acts.map(a => {
    if (o?.k === "perm") return a;
    if (o?.k === "back") return { ...a, until_return_of: o.id };
    if (o?.k === "one") {
      const sh = shiftsOf(a) || [];
      if (sh.length === 1) return { type: "status", doctor_id: a.doctor_id, kind: "starts_at", date: o.date, from: A.hhmm(sh[0].s), until: A.hhmm(sh[0].e), ...(sh[0].e <= sh[0].s ? { until_next_day: true } : {}) };
      return { ...a, start_date: o.date, end_date: o.date };
    }
    return { ...a, ...(dur.start ? { start_date: dur.start } : {}), ...(dur.until ? { end_date: dur.until } : {}), ...(dur.back ? { until_return_of: dur.back } : {}) };
  });
}
function pickOpt(text, opts) {
  const raw = lat(text).replace(/[️⃣.!،,]/g, "").trim(), n = nn(raw).trim();
  const num = /^([1-9])$/.exec(raw)?.[1]; if (num) return opts[+num - 1] || null;
  const t = A.nowR();
  if (/^(اليوم)(\s+(بس|فقط))?$/.test(n)) return { k: "one", date: t.iso };
  if (/^(بكره|بكرا|غدا|باكر)(\s+(بس|فقط))?$/.test(n)) return { k: "one", date: A.isoPlus(t.iso, 1) };
  { const m = /^(يوم\s+)?(ال)?(\S+)(\s+(بس|فقط))?$/.exec(n); if (m && wdW(m[3]) != null) return { k: "one", date: nextOn(wdW(m[3]), t.iso) }; }
  if (PERMW.test(n) && n.split(/\s+/).length <= 4) return { k: "perm" };
  return null;
}
async function durPre(text, quoted) {
  const qc = /#([A-Z]\d{2}|[A-Z][A-Z0-9]{2})\b/.exec(quoted || "")?.[1], lo = lastModel();
  // 1) سؤال «لمدة كم؟» من الخاص
  if (durQ && Date.now() - durQ.at < 24 * 3600e3 && (qc ? qc === durQ.code : lo.includes("#" + durQ.code))) {
    const o = pickOpt(text, durQ.opts), dur = o ? null : durOf(text, durQ.start);
    if (o || dur) { const acts = withDur(durQ.acts, o, dur); durQ = null; persist(); const out = (await execute(acts, [], [])).join("\n"); await AS.after(acts); return out; }
    return null;
  }
  // 2) خيارات تغيير دوام من قروب الاستقبال (#S…) وأنس كتب مدة أو رقم
  if (!/#S[A-Z0-9]{2}/.test((quoted || "") + "\n" + lo)) return null;
  const items = ((await A.db.doc("bot/pending_clarify").get()).data()?.items || []).filter(i => i.opts && Date.now() - i.at < 24 * 3600e3);
  const it = qc ? items.find(i => i.code === qc) : items.find(i => lo.includes("#" + i.code));
  if (!it) return null;
  const raw = lat(text).replace(/[️⃣.!،,]/g, "").trim();
  if (/^[1-9]$/.test(raw) && it.opts[+raw - 1]) return (await execute([{ type: "option", code: it.code, n: +raw }], items, [])).join("\n");
  const dur = it.dur?.shifts?.length ? durOf(text, it.dur.start) : null; if (!dur) return null;
  const sh = it.dur.shifts, base = { type: "schedule", doctor_id: it.doctorId, mode: "all_days", shifts: sh.map(x => ({ start_time: A.hhmm(x.s), end_time: A.hhmm(x.e) })), from: A.hhmm(sh[0].s), until: A.hhmm(sh[0].e), ...(it.dur.start > A.nowR().iso ? { start_date: it.dur.start } : {}) };
  return (await execute([...withDur([base], null, dur), { type: "resolve", code: it.code }], items, [])).join("\n");
}

const TENSE = [[/(^|\s)(عدّلت|عدلت)(?=\s|$)/g, "$1بعدّل"], [/(^|\s)(أضفت|اضفت|ضفت)(?=\s|$)/g, "$1بضيف"], [/(^|\s)(حطيت)(?=\s|$)/g, "$1بحط"], [/(^|\s)(شلت)(?=\s|$)/g, "$1بشيل"],
  [/(^|\s)(سجّلت|سجلت)(?=\s|$)/g, "$1بسجّل"], [/(^|\s)(غيّرت|غيرت)(?=\s|$)/g, "$1بغيّر"], [/(^|\s)(طبّقت|طبقت)(?=\s|$)/g, "$1بطبّق"], [/(^|\s)(خليت|خلّيت)(?=\s|$)/g, "$1بخلّي"],
  [/(^|\s)(ألغيت|الغيت)(?=\s|$)/g, "$1بلغي"], [/(^|\s)(رجّعت|رجعت)(?=\s|$)/g, "$1برجّع"], [/(^|\s)(نقلت)(?=\s|$)/g, "$1بنقل"], [/(^|\s)(وأضفت|واضفت)(?=\s|$)/g, "$1وبضيف"], [/(^|\s)(وعدّلت|وعدلت)(?=\s|$)/g, "$1وبعدّل"]];
// آخر 10 ردود للذكاء (للمراجعة لو صار شي غلط) — بدون بيانات مراجعين
const bl = [];
function blog(user, out) {
  bl.push({ at: Date.now(), model: out.__model || "", user: String(user).slice(0, 400), understood: String(out.understood || "").slice(0, 600), reply: String(out.reply || "").slice(0, 400), actions: JSON.stringify(out.actions || []).slice(0, 1500), cf: !!out.confirm_first, up: !!out.use_proposal });
  while (bl.length > 10) bl.shift();
  A.db.doc("board/bawadi_brainlog").set({ items: bl, at: Date.now() }).catch(() => {});
}

/* ---------- التحقق قبل التنفيذ ---------- */
const lat = s => String(s ?? "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
// «12:00» / «١٢:٠٠» / «8» / «8:30 م» / «8pm» → دقايق (ص/م لو انكتبت تغلب)
const toMin = s => {
  const t = lat(s).trim().toLowerCase(), x = /^(\d{1,2})(?::(\d{2}))?\s*(ص|م|am|pm|صباحا|مساء|مساءً)?/.exec(t); if (!x || +x[1] > 24) return null;
  let h = +x[1] % 24; const ap = x[3] || ""; if (/^(م|pm|مساء)/.test(ap) && h < 12) h += 12; if (/^(ص|am|صباح)/.test(ap) && h === 12) h = 0;
  return h * 60 + +(x[2] || 0);
};
// (2.16.1) التاريخ بأي شكل يكتبه الذكاء أو أنس → YYYY-MM-DD («28-11-2026» و«28/11» و«28 نوفمبر» و«٢٨-١١» كانت تطيح الإجازة بـ«ناقص تاريخ»)
const MON = [["يناير", "jan"], ["فبراير", "feb"], ["مارس", "mar"], ["ابريل", "apr"], ["مايو", "may"], ["يونيو", "jun"], ["يوليو", "jul"], ["اغسطس", "aug"], ["سبتمبر", "sep"], ["اكتوبر", "oct"], ["نوفمبر", "nov"], ["ديسمبر", "dec"]];
const monthNum = w => { const n = String(w || "").toLowerCase().replace(/[أإآ]/g, "ا"); const i = MON.findIndex(([ar, en]) => n.startsWith(ar) || n.startsWith(en)); return i < 0 ? 0 : i + 1; };
const mkISO = (y, m, d) => { if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 2000)) return ""; const x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCMonth() === m - 1 ? x.toISOString().slice(0, 10) : ""; };
function guessY(m, d, ref) {                                                   // بدون سنة: هالسنة، ولو فات بأكثر من شهرين → السنة الجاية
  const y = +ref.slice(0, 4), a = mkISO(y, m, d); if (!a) return "";
  return a < A.isoPlus(ref, -60) ? mkISO(y + 1, m, d) : a;
}
function toISO(v, ref) {
  if (v == null || v === "") return "";
  ref = ref || A.nowR().iso;
  const t = lat(v).trim().replace(/[\u200e\u200f]/g, ""); let m;
  if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(t))) return mkISO(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/.exec(t))) return mkISO(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  if ((m = /^(\d{1,2})[-\/.](\d{1,2})$/.exec(t))) return guessY(+m[2], +m[1], ref);
  if ((m = /^(\d{1,2})\s*(?:من\s+)?([\p{L}]+)(?:\s+(\d{4}))?/u.exec(t)) && monthNum(m[2])) return m[3] ? mkISO(+m[3], monthNum(m[2]), +m[1]) : guessY(monthNum(m[2]), +m[1], ref);
  return "";
}
// الكلام مقطّع: سطور، وفواصل، و«ود.» — وكل طبيب ياخذ من مقطعه (ولو مقطعه ما فيه وقت/تاريخ: من المقطع اللي بعده — «د. علياء ود. كريم من 23 إلى 27»)
const GENERIC = new Set(["محمد", "احمد", "علي", "عبدالله", "دكتور", "دكتوره", "الدكتور", "الدكتوره"]);
function nameKeys(d) {
  const ws = [A.shortName(d.name), ...(d.aliases || [])].flatMap(n => A.norm(n).split(/\s+/)).map(w => w.replace(/^د$/, "")).filter(w => w.length > 2 && !GENERIC.has(w));
  return [...new Set(ws)];
}
// اسم مكتوب غلط أو ناقص: «اكرا» = اكرامي، «الشوربجي»، «سكلا»… (حرف زيادة/ناقص يمر)
function lev(x, y) { if (Math.abs(x.length - y.length) > 1) return 9; const dp = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]); for (let j = 1; j <= y.length; j++) dp[0][j] = j; for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)); return dp[x.length][y.length]; }
function nameHit(w, k) {
  if (!w || w.length < 3) return false;
  const k2 = k.replace(/^ال(?=[\u0600-\u06FF]{4})/, "");
  return w === k || w === k2 || (w.length >= 4 && (k.startsWith(w) || k2.startsWith(w))) || (k2.length >= 5 && w.startsWith(k2.slice(0, 5))) || (w.length >= 5 && lev(w, k2) <= 1);
}
// لكل ذكر للطبيب: نافذة من اسمه لين اسم الطبيب اللي بعده — ولو ما فيها وقت/تاريخ تكبر وتشمل اللي بعده («علياء وكريم 23 الى 27»)
const cleanTok = w => A.norm(w).replace(/^(د|ود|و|لد|ل)(?=[\u0600-\u06FF]{3})/, "").replace(/^ال(?=[\u0600-\u06FF]{4})/, "");
function segsFor(d, txt) {
  if (!d) return [];
  const mine = nameKeys(d), others = A.docs().filter(x => x.id !== d.id).map(nameKeys), out = [];
  for (const line of String(txt || "").split(/\n+/)) {
    const raw = line.split(/\s+/).filter(Boolean), toks = raw.map(cleanTok);
    const hit = toks.map(w => mine.some(k => nameHit(w, k)));
    const oth = toks.map((w, i) => !hit[i] && others.some(ks => ks.some(k => nameHit(w, k))));
    hit.forEach((h, i) => {
      if (!h || (i > 0 && hit[i - 1])) return;                               // أول كلمة من اسمه بس
      const bounds = []; for (let j = i + 1; j < toks.length; j++) if (oth[j] && !oth[j - 1] && !hit[j - 1]) bounds.push(j);
      bounds.push(toks.length);
      out.push([...new Set(bounds.slice(0, 3))].map(b => raw.slice(i, b).join(" ")));
    });
  }
  return out;
}
// مدى الإجازة من نص: «من 23 إلى 28 نوفمبر» / «23-11-2026 إلى 25-11-2026» / «من ٢٣ الى ٢٥ يرجع ٢٦»
function rangeIn(txt, ref) {
  const t = lat(txt); ref = ref || A.nowR().iso; let m;
  const full = [...t.matchAll(/\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}/g)].map(x => toISO(x[0], ref)).filter(Boolean);
  const ret = /(?:يرجع|ترجع|يباشر|تباشر|يداوم|تداوم|عودته|عودتها|رجوعه|رجوعها|مباشرته|مباشرتها)[^\d]{0,12}(\d{1,2}(?:[-\/.]\d{1,2}(?:[-\/.]\d{2,4})?)?)(?:\s*([\p{L}]+))?/u.exec(t);
  let start = "", end = "";
  if (full.length < 2) {                                                     // «من 23/11 الى 2/12» (بدون سنة)
    const part = [...t.matchAll(/(?<![\d\/.-])(\d{1,2})[\/.-](\d{1,2})(?![\d\/.-])/g)].map(x => guessY(+x[2], +x[1], ref)).filter(Boolean);
    if (part.length >= 2 && !full.length) { start = part[0]; end = part[1] < part[0] ? guessY(+part[1].slice(5, 7), +part[1].slice(8, 10), A.isoPlus(ref, 300)) : part[1]; }
  }
  if (start && end) { /* خلاص */ }
  else if (full.length >= 2) { start = full[0]; end = full[1]; }
  else if ((m = /(?:من|بين)?\s*(\d{1,2})(?:\s*([\p{L}]+))?\s*(?:الى|إلى|لين|لغاية|حتى|ل|-|–|و)\s*(\d{1,2})(?!\d|[-\/.:]\d)(?:\s*([\p{L}]+))?/u.exec(t))) {
    const mon2 = monthNum(m[4]) || monthNum(m[2]), mon1 = monthNum(m[2]) || mon2;
    const today = ref, y = +ref.slice(0, 4);
    let M1 = mon1, M2 = mon2;
    if (!M2) { M1 = M2 = +ref.slice(5, 7); if (+m[1] < +ref.slice(8, 10) - 3 && +m[3] < +ref.slice(8, 10) - 3) { M1 = M2 = M1 % 12 + 1; } }
    if (+m[3] < +m[1] && M1 === M2) M2 = M1 % 12 + 1;                          // «من 28 إلى 3» → الشهر اللي بعده
    start = guessY(M1, +m[1], today); end = guessY(M2, +m[3], today);
    if (start && end && end < start) end = guessY(M2, +m[3], A.isoPlus(today, 300));
  } else if (full.length === 1) start = full[0];
  if (!start && ret) { const lone = /(?<![\d:])(\d{1,2})(?![\d:])/.exec(t.slice(0, ret.index)); if (lone) { const cm = +ref.slice(5, 7); start = guessY(+lone[1] < +ref.slice(8, 10) - 3 ? cm % 12 + 1 : cm, +lone[1], ref); } }
  if (!end && ret) { const r = toISO(/[-\/.]/.test(ret[1]) ? ret[1] : ret[1] + (monthNum(ret[2]) ? " " + ret[2] : "-" + (start ? +start.slice(5, 7) : +ref.slice(5, 7))), ref); if (r) end = A.isoPlus(r, -1); }
  return { start, end };
}
function fillVac(a, reply, user) {
  if (a.type !== "vacation" || (ISO(a.start_date) && ISO(a.end_date))) return a;
  const o = { ...a };
  if (!ISO(o.end_date) && ISO(o.return_date)) o.end_date = A.isoPlus(o.return_date, -1);
  if (ISO(o.start_date) && ISO(o.end_date)) return o;
  const d = o.doctor_id ? docOf(o.doctor_id) : null;
  for (const src of [user, reply]) for (const seg of segsFor(d, src)) {
    for (let k = 1; k <= seg.length; k++) {
      const r = rangeIn(seg.slice(0, k).join(" ")); if (!r.start && !r.end) continue;
      if (!ISO(o.start_date) && r.start) o.start_date = r.start;
      if (!ISO(o.end_date) && r.end) o.end_date = r.end;
      if (ISO(o.start_date) && ISO(o.end_date)) return o;
      break;
    }
  }
  return o;
}
// أسماء الحقول من الذكاء → الأسماء الداخلية (يقبل الاسم القديم احتياط)
function normA(a) {
  const o = {}; for (const [k, v] of Object.entries(a || {})) if (v !== "" && v != null && !(Array.isArray(v) && !v.length)) o[k] = v;   // الحقول الفاضية اللي يعبّيها الذكاء بلا معنى
  for (const k of ["date", "start_date", "end_date", "return_date"]) if (o[k] != null && !ISO(o[k])) { const v = toISO(o[k]); if (v) o[k] = v; else delete o[k]; }
  if (!o.end_date && o.until_date) { const v = toISO(o.until_date); if (v) o.end_date = v; }
  if (!o.date && o.start_date && ["status", "cancel_plan"].includes(o.type)) o.date = o.start_date;
  o.from = a.start_time ?? a.from ?? (a.kind === "starts_at" ? a.at_time : undefined);
  o.until = a.end_time ?? a.until;
  o.at = a.at_time ?? a.at;
  if ((o.type === "alias" || o.type === "remove_alias") && !o.alias && o.name) o.alias = o.name;
  return o;
}
// (2.13.1) الذكاء (خصوصاً flash-lite) يكتب الوقت في الرد وينسى end_time → ناخذ الوقتين من رده أو من كلام أنس
const NEEDS_T = a => (a.type === "status" && a.kind === "starts_at") || (a.type === "schedule" && a.mode !== "set_days") || (a.type === "schedule" && a.mode === "set_days" && a.from) || a.type === "add_doctor";
function timesIn(txt) {
  const t = lat(txt), out = [];
  for (const m of t.matchAll(/(?<![\d:])(\d{1,2})(?::(\d{2}))?\s*(?:ال?ساعه|الساعة)?\s*(صباحاً|صباحا|مساءً|مساء|الصبح|بالصبح|الصباح|الفجر|فجراً|فجرا|الظهر|ظهراً|ظهرا|العصر|عصراً|عصرا|المغرب|الليل|بالليل|ليلاً|ليلا|ص|م|am|pm)?(?![\d:])/gi)) {
    if (!m[2] && !m[3]) continue;                                           // رقم بدون : ولا ص/م (تاريخ/عدد) → نتجاهله
    let h = +m[1]; if (h > 24) continue; const ap = m[3] || "";
    if (/^(م|pm|مساء|العصر|عصر|المغرب|الليل|بالليل|ليل)/i.test(ap) && h < 12 && !(/ليل/.test(ap) && h <= 4)) h += 12; if (/^(ص|am|صباح|الصبح|بالصبح|الصباح|الفجر|فجر)/i.test(ap) && h === 12) h = 0; if (/ظهر/.test(ap) && h < 6) h += 12;
    out.push(String(h % 24).padStart(2, "0") + ":" + (m[2] || "00"));
  }
  return [...new Set(out)];
}
// (2.16.1) أوقات كل طبيب من سطره هو: «د. مجدي نصيف — بكرة: دوامه من 9ص إلى 5م» (رسالة البوت اللي أنس رد عليها) أو «د.اكرامي الشرقاوي من ٥-١»
function timesFor(d, txt) {
  if (!d) return [];
  for (const seg of segsFor(d, txt)) for (let k = 1; k <= seg.length; k++) { const ts = timesIn(seg.slice(0, k).join(" ")); if (ts.length >= 2) return ts; if (ts.length) break; }
  return [];
}
function fillTimes(a, reply, user, many = false) {
  if (!NEEDS_T(a) || (a.from && a.until) || (a.type === "schedule" && (shiftsOf(a) || []).length)) return a;
  const own = timesFor(a.doctor_id ? docOf(a.doctor_id) : null, (user || "") + "\n" + (reply || ""));
  if (own.length >= 2) return { ...a, from: a.from || own[0], until: a.until || own.find(x => x !== (a.from || own[0])) || own[1] };
  if (many) return a;                                                        // أكثر من طبيب: لا ناخذ أوقات طبيب ثاني — الأحسن يقول «ناقص» من إنه يحفظ غلط
  for (const src of [reply, user]) {
    const ts = timesIn(src || ""); if (ts.length < 2) continue;
    const o = { ...a };
    if (!o.from) o.from = ts[0];
    if (!o.until) o.until = ts.find(x => x !== o.from) || ts[1];
    return o;
  }
  return a;
}
// (2.19.0) فترات الدوام: shifts من الذكاء (فترتين) أو from/until (فترة وحدة) → [{s, e}] بالدقايق
const tmn = v => typeof v === "number" ? v : toMin(v);
function shiftsOf(a) {
  if (Array.isArray(a.shifts) && a.shifts.length) {
    const L = a.shifts.map(x => ({ s: tmn(x.start_time ?? x.from ?? x.s), e: tmn(x.end_time ?? x.until ?? x.e) })).filter(x => x.s != null && x.e != null && x.s !== x.e).map(pmFix);
    if (L.length) return L.sort((x, y) => x.s - y.s);
  }
  const f = toMin(a.from), u = toMin(a.until); return f != null && u != null && f !== u ? [pmFix({ s: f, e: u })] : null;
}
// (2.19.4) «من ٥:٣٠ م الى ١٠:٣٠» → 10:30 انقرت صباح (فترة 17 ساعة) — فترة تعدّي نص الليل أطول من 12 ساعة والنهاية قبل 12 الظهر = مسائي
function pmFix(x) { const len = (x.e - x.s + 1440) % 1440; return x.e < x.s && x.e < 720 && len > 720 && x.e + 720 > x.s ? { s: x.s, e: x.e + 720 } : x; }
const sameSh = (x, y) => JSON.stringify((x || []).map(z => [z.s, z.e])) === JSON.stringify((y || []).map(z => [z.s, z.e]));
// الذكاء كتب فترة وحدة والسطر فيه فترتين («سحر 11 am الى 2 pm و من 5:30 pm الى 10:30 pm») → نكمّلها من سطر الطبيب نفسه
function fillShifts(a, user, reply = "") {
  if (a.type !== "schedule" || a.mode === "only_days") return a;
  const d = a.doctor_id ? docOf(a.doctor_id) : null; if (!d) return a;
  const r = fillShiftsIn(a, d, user); if (r !== a || !reply) return r;
  return fillShiftsIn(a, d, reply);                                               // (2.19.4) كلام أنس بدون ص/م → من رد الذكاء (يكتبها 11:00–14:00 و 17:30–22:30)
}
function fillShiftsIn(a, d, user) {
  for (const seg of segsFor(d, user)) {
    let ts = timesIn(seg[0] || ""); if (ts.length < 4 || ts.length % 2) continue;
    const pairs = []; for (let i = 0; i < ts.length; i += 2) pairs.push({ start_time: ts[i], end_time: ts[i + 1] });
    if ((shiftsOf(a) || []).length < pairs.length) return { ...a, shifts: pairs, from: pairs[0].start_time, until: pairs[0].end_time };
    return a;
  }
  return a;
}
// «لين يرجع أكرامي»: الذكاء ممكن يكتب الاسم بدل الـ id
const findDocLoose = v => { if (!v) return null; const x = docOf(v); if (x) return x; const n = A.norm(String(v).replace(/^(د|دكتور|دكتوره)\.?\s+/, "")); return n.length < 3 ? null : A.docs().find(d => A.norm(A.shortName(d.name)).includes(n) || (d.aliases || []).some(y => A.norm(y).includes(n)) || nameKeys(d).some(k => nameHit(n.split(" ")[0], k))) || null; };
function fillBack(a) {
  if (a.type !== "schedule" || !a.until_return_of) return a;
  const d = findDocLoose(a.until_return_of);
  if (d && d.id === a.doctor_id) { const { until_return_of, ...rest } = a; return rest; }   // (2.19.4) «لين يرجع» نفس الطبيب = غلط من الذكاء → نشيلها
  return d ? { ...a, until_return_of: d.id } : { ...a, __bad: `«لين يرجع ${a.until_return_of}» — ما عرفت مين الطبيب` };
}
const backInfo = id => { const v = (A.getBoard()?.vacations || []).filter(x => x.doctorId === id && (!x.end || x.end >= A.nowR().iso)).sort((p, q) => p.start.localeCompare(q.start))[0]; return v ? (v.end ? `يرجع ${dayName(A.isoPlus(v.end, 1))} ${dmy(A.isoPlus(v.end, 1))}` : "إجازته مفتوحة") : "مو مسجّل عليه إجازة"; };
const tmpLabel = a => ISO(a.end_date) ? `مؤقت لين ${dayName(a.end_date)} ${dmy(a.end_date)}` : a.until_return_of ? `مؤقت لين يرجع د. ${A.shortName(docOf(a.until_return_of)?.name || "—")} (${backInfo(a.until_return_of)})` : "";
// القسم ناقص في نقل/إضافة → من رد الذكاء («لقسم الأطفال») أو من كلام أنس
function fillDept(a, reply, user) {
  if (!["move_doctor", "add_doctor"].includes(a.type) || A.findDep(a.dept)) return a;
  const m = /قسم\s+([^\s.،,]+(?:\s+(?:و|والأذن|البولية|الطبيعي|العام|والولادة|والحنجرة)[^\s.،,]*)*)/.exec(reply || "");
  const dep = (m && A.findDep(m[1])) || A.findDep(String(user || "").split("\n").pop());
  return dep && !/أخرى/.test(dep.name) ? { ...a, dept: dep.name } : a;
}
const ISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
// (2.13.2) التاريخ: الذكاء ينسى date → كان ينحفظ على اليوم (دوام الجمعة انحفظ الخميس 12/11). الحين ناخذ اليوم من كلام أنس أو من الرد،
// ولو الرد يقول «بكرة/الجمعة» والفعل على يوم ثاني → نوقفه ونرجع للذكاء
const WDN = [/الاحد/, /(^|\s)(ال)?اثنين/, /(^|\s)(ال)?ثلاثا/, /(^|\s)(ال)?اربعا/, /(^|\s)(ال)?خميس/, /(^|\s)(ال)?جمعه/, /(^|\s)(ال)?سبت/];
function daysIn(txt) {
  const t = A.nowR(), out = new Set();
  let s = String(txt || "").replace(/[ً-ْ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
  s = s.replace(/(صباح|فجر|الصبح|ص)\s*(يوم\s+)?(ال)?(احد|اثنين|ثلاثاء?|اربعاء?|خميس|جمعه|سبت)/g, " ");   // نهاية دوام يعدّي الليل — مو يوم الدوام
  if (/بعد\s*(بكره|بكرا|غدا|باكر)/.test(s)) { out.add(A.isoPlus(t.iso, 2)); s = s.replace(/بعد\s*(بكره|بكرا|غدا|باكر)/g, " "); }
  if (/(^|[^\p{L}])(بكره|بكرا|غدا|باكر)(?![\p{L}])/u.test(s)) out.add(A.isoPlus(t.iso, 1));
  if (/(^|[^\p{L}])(اليوم|الليله)(?![\p{L}])/u.test(s)) out.add(t.iso);
  WDN.forEach((re, wd) => { if (re.test(s)) out.add(A.isoPlus(t.iso, (wd - t.wd + 7) % 7)); });
  return out;
}
function fillDate(a, reply, user) {
  if (!["status", "cancel_plan"].includes(a.type)) return a;
  const U = daysIn(user), R = daysIn(reply), o = { ...a };
  if (!ISO(o.date)) {
    const pick = U.size === 1 ? U : U.size ? null : R.size === 1 ? R : R.size ? null : new Set([A.nowR().iso]);
    if (pick) o.date = [...pick][0]; else o.__bad = "أي يوم بالضبط؟ (date ناقص)";
    return o;
  }
  const t = A.nowR();
  if (o.until_next_day && o.date === A.isoPlus(t.iso, -1)) return o;               // دوام أمس اللي يعدّي الليل
  const one = U.size === 1 ? U : R.size === 1 && !U.size ? R : null;
  if (one && !one.has(o.date)) o.__bad = `التاريخ ${o.date} ما يطابق اليوم المذكور (${[...one][0]})`;
  return o;
}
// نفس الفعل مرتين (د. مجدي انكتب مرتين 12/11) → مرة وحدة
function uniq(list) { const seen = new Set(); return list.filter(a => { const k = JSON.stringify(a); if (seen.has(k)) return false; seen.add(k); return true; }); }
const docOf = id => A.docs().find(x => x.id === id);
function check(a) {
  if (a.__bad) return a.__bad;
  { const w = AS?.checkAct(a); if (w != null) return w; }
  const d = a.doctor_id ? docOf(a.doctor_id) : null, t = A.nowR();
  if (["status", "cancel_plan", "schedule", "info", "vacation", "end_vacation", "remove_doctor", "alias", "remove_alias", "move_doctor", "branch_day"].includes(a.type) && !d) return `ما لقيت الطبيب (${a.doctor_id || "—"}) في الجدول`;
  if (a.type === "status") {
    const date = ISO(a.date) ? a.date : t.iso;
    if (date < t.iso && !(date === A.isoPlus(t.iso, -1) && a.until_next_day)) return `التاريخ ${a.date} فات`;
    if (date > A.isoPlus(t.iso, 14)) return "التاريخ بعيد (أكثر من أسبوعين)";
    if (a.kind === "starts_at" && toMin(a.from) == null) return `د. ${A.shortName(d.name)}: ناقص وقت البداية`;
    if (!["starts_at", "present", "leaves_at", "late", "stop", "free", "appointments_only", "busy", "absent_today", "clear"].includes(a.kind)) return `نوع حالة غريب (${a.kind})`;
  }
  if (a.type === "schedule" && a.mode === "set_days" && !(a.days || []).length) return `د. ${A.shortName(d.name)}: أي أيام؟ (set_days بدون أيام)`;
  if (a.type === "schedule" && !shiftsOf(a) && (a.mode !== "set_days" || a.from || a.until || (a.shifts || []).length)) return `د. ${A.shortName(d.name)}: وش وقت دوامه؟ (مثلاً «9ص–5م»)`;
  if (a.type === "schedule" && ISO(a.end_date) && a.end_date < (ISO(a.start_date) ? a.start_date : t.iso)) return `د. ${A.shortName(d.name)}: نهاية المؤقت (${a.end_date}) قبل بدايته`;
  if (a.type === "schedule" && a.until_return_of && a.until_return_of === a.doctor_id) return "لين يرجع مين؟ (نفس الطبيب)";
  if (a.type === "vacation" && (!ISO(a.start_date) || !ISO(a.end_date))) return `د. ${A.shortName(d.name)}: من متى لين متى الإجازة؟ (مثلاً «من 23 لين 25»)`;
  if (a.type === "end_vacation" && !ISO(a.return_date)) return "ناقص يوم المباشرة";
  if (a.type === "add_doctor" && !String(a.name || "").trim()) return "ناقص اسم الطبيب";
  if (a.type === "branch_day" && !a.clear && !String(a.branch || "").trim()) return "ناقص اسم الفرع";
  if (a.type === "branch_day" && !(a.days || []).length && !ISO(a.date)) return "يوم واحد (date) ولا كل أسبوع (days)؟";
  if (a.type === "restore_doctor" && !a.doctor_id) return "ناقص الطبيب";
  if (a.type === "add_doctor" && !A.findDep(a.dept)) return `ناقص القسم${a.dept ? " («" + a.dept + "» مو من أقسام الجدول)" : ""} — وش قسمه؟`;
  if ((a.type === "alias" || a.type === "remove_alias") && !String(a.alias || "").trim()) return "ناقص الاسم الثاني (alias)";
  if (a.type === "move_doctor" && !A.findDep(a.dept)) return `القسم «${a.dept || "—"}» مو موجود في الجدول`;
  return "";
}
function describe(a) {
  { const x = AS?.describeAct(a); if (x) return x; }
  const d = a.doctor_id ? docOf(a.doctor_id) : null, n = d ? "د. " + A.shortName(d.name) : a.name ? "د. " + a.name : a.doctor_id ? `(${a.doctor_id})` : "";
  const t = A.nowR(), date = ISO(a.date) ? a.date : t.iso, when = date === t.iso ? "اليوم" : date === A.isoPlus(t.iso, 1) ? `بكرة ${dayName(date)}` : `${dayName(date)} ${dmy(date)}`;
  const f = toMin(a.from), u = toMin(a.until), at = toMin(a.at), next = a.until_next_day || (f != null && u != null && u <= f);
  const H = m => A.hm(m), uTxt = u != null ? H(u) + (next ? ` (صباح ${dayName(A.isoPlus(date, 1))})` : "") : "";
  switch (a.type) {
    case "status": return `• ${n} — ${when}: ` + ({ starts_at: `دوام من ${f != null ? H(f) : "؟"}${u != null ? " لين " + uTxt : ""}`, present: `موجود${u != null ? " لين " + uTxt : ""}`, leaves_at: `يطلع ${uTxt || (at != null ? H(at) : "")}`, late: `متأخر${at != null ? " يوصل " + H(at) : a.delay_minutes ? " " + a.delay_minutes + " دقيقة" : ""}`, stop: `وقف استقبال${at != null ? " الساعة " + H(at) : ""}`, free: "فاضي — دخّلوا له", appointments_only: `مواعيد فقط${at != null ? " من " + H(at) : ""}`, busy: "زحمة", absent_today: "غير متواجد", clear: "شلت حالته — يرجع لجدوله" }[a.kind] || a.kind);
    case "cancel_plan": return `• ${n} — ألغيت المحفوظ ليوم ${dayName(a.date || date)} ${dmy(a.date || date)}`;
    case "schedule": { const sh = shiftsOf(a), tl = tmpLabel(a); return `• ${n} — ${tl ? "دوام مؤقت" : "دوام ثابت"}: ${a.mode === "only_days" ? "كل " + (a.days || []).map(i => WD[i]).join(" و") + " " : a.mode === "set_days" ? "أيامه " + (a.days || []).map(i => WD[i]).join("، ") + " " : "كل أيامه "}${sh ? sh.map(x => H(x.s) + " – " + H(x.e)).join(" و ") : ""}${ISO(a.start_date) ? " (من " + dayName(a.start_date) + " " + dmy(a.start_date) + ")" : ""}${tl ? " — " + tl.replace(/^مؤقت /, "") + "، وبعدها يرجع لدوامه الثابت" : ""}`; }
    case "info": return `• ${n} — ${[a.fee ? "كشفية " + a.fee : "", a.room ? "غرفة " + a.room : "", a.ext ? "تحويلة " + a.ext : ""].filter(Boolean).join(" · ")}`;
    case "vacation": return `• ${n} — إجازة ${dmy(a.start_date)} → ${dmy(a.end_date)}`;
    case "end_vacation": return `• ${n} — يباشر ${dayName(a.return_date)} ${dmy(a.return_date)}`;
    case "add_doctor": return `• إضافة د. ${a.name} — ${a.dept || "—"}${f != null && u != null ? " · " + H(f) + " – " + H(u) : ""}${a.days?.length ? " · " + a.days.map(i => WD[i]).join("،") : ""}`;
    case "move_doctor": return `• نقل ${n} لقسم ${a.dept}`;
    case "restore_doctor": return `• رجّعت د. ${a.__name || a.doctor_id} للجدول`;
    case "branch_day": return `• ${n} — ${a.clear ? "شلت «في فرع ثاني»" : "في فرع " + String(a.branch || "").replace(/^(فرع|سابا)\s+/, "")}${(a.days || []).length ? " كل " + a.days.map(i => WD[i]).join(" و") : ISO(a.date) ? ` يوم ${dayName(a.date)} ${dmy(a.date)}` : ""}`;
    case "remove_doctor": return `• شيل ${n} من الجدول كله نهائياً${ISO(a.start_date) ? " يوم " + dmy(a.start_date) : ""}`;
    case "remove_alias": return `• ${n} — شلت الاسم الثاني «${a.alias}»`;
    case "alias": return `• ${n} — اسم ثاني «${a.alias}»`;
    case "pending_doctor": return `• الطبيب المنتظر #${a.code}: ${a.decision === "approve" ? "إضافة" : "رفض"}`;
    case "option": return `• #${a.code}: الخيار ${a.n}`;
    case "resolve": return `• قفلت #${a.code}`;
    case "undo": return "• تراجع عن آخر تعديل في الجدول";
    case "reports": return `• تقارير القروب: ${a.on ? "شغالة" : "موقفة"}`;
  }
  return "• " + a.type;
}

/* ---------- التنفيذ + القراءة من القاعدة ---------- */
const BY = "أنس (الخاص)";
const STK = { starts_at: ["starts"], present: ["present"], leaves_at: ["leaves"], late: ["late"], stop: ["stop", "stop_at"], free: ["free"], appointments_only: ["appt", "appt_at"], busy: ["busy"], absent_today: ["absent"] };
async function execute(actions, pclar, pdocs) {
  const out = [], t = A.nowR(), resolves = [];
  for (const a of actions) {
    const why = check(a);
    if (why) { out.push(`⚠️ ما طبّقت: ${describe(a).replace(/^• /, "")} — ${why}`); continue; }
    if (a.type === "resolve") { resolves.push(a); continue; }
    let r, desc = describe(a);                                             // قبل التنفيذ (بعد الحذف ما نلقى اسم الطبيب)
    try { r = await run(a, t, pclar, pdocs); } catch (e) { r = { ok: false, why: String(e?.message || e).slice(0, 140) }; }
    if (r?.skip) continue;
    if (a.type === "restore_doctor") desc = describe(a);                       // الاسم يعرف بعد التنفيذ
    out.push(r?.ok ? `✅ ${/^(complaint|task|license)_/.test(a.type) ? "" : "انحفظ وتأكدت منه في الموقع: "}${desc.replace(/^• /, "")}${r.note ? " — " + r.note : ""}` : `❌ ما انحفظ: ${desc.replace(/^• /, "")}${r?.why ? " — " + r.why : ""}`);
  }
  // نقفل الأسئلة المنتظرة ونحط ✅ في القروب — بس لو كل اللي قبلها انحفظ
  const allOk = !out.some(l => /^(❌|⚠️)/.test(l));
  for (const a of resolves) {
    const it = pclar.find(i => i.code === String(a.code || "").replace("#", "").toUpperCase()) || null;
    if (!it) { out.push(`⚠️ ما لقيت #${a.code}`); continue; }
    if (!allOk && actions.length > 1) { out.push(`⏸ ما قفلت #${it.code} لأن فيه شي ما انحفظ`); continue; }
    await A.db.runTransaction(async tx => { const ref = A.db.doc("bot/pending_clarify"), c = (await tx.get(ref)).data() || {}; tx.set(ref, { items: (c.items || []).filter(i => i.code !== it.code) }); });
    let react = false;
    if (it.key?.id && actions.length > 1) { try { await A.getSock()?.sendMessage(it.key.remoteJid, { react: { text: "✅", key: { ...it.key, participant: it.key.participant || undefined } } }); react = true; } catch {} }
    out.push(`☑️ قفلت #${it.code}${react ? " وحطيت ✅ على رسالته في القروب" : ""}`);
  }
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function run(a, t, pclar, pdocs) {
  { const r = AS ? await AS.act(a) : null; if (r) return r; }
  const d = a.doctor_id ? docOf(a.doctor_id) : null, id = d?.id;
  const readToday = async () => (await A.db.doc("board/bawadi_today").get()).data() || {};
  const readPlan = async () => (await A.db.doc("board/bawadi_plan").get()).data()?.items || [];
  const readBoardDoc = async () => { const b = (await A.db.doc("board/bawadi").get()).data() || {}; return { b, x: (b.departments || []).flatMap(p => p.doctors || []).find(y => y.id === id) }; };

  if (a.type === "status") {
    let date = ISO(a.date) ? a.date : t.iso, f = toMin(a.from), u = toMin(a.until), at = toMin(a.at);
    if (u != null && (a.until_next_day || (f != null && u <= f))) u += 1440;
    if (date < t.iso) {                                          // دوام أمس اللي يعدّي نص الليل → جزء اليوم منه
      if (u == null || u < 1440) return { ok: false, why: "اليوم فات" };
      date = t.iso; f = 0; u -= 1440;
    }
    const future = date > t.iso;
    if (a.kind === "clear") {
      if (future) return run({ type: "cancel_plan", doctor_id: id, date }, t);
      await A.db.runTransaction(async tx => {
        const ref = A.db.doc("board/bawadi_today"), c = (await tx.get(ref)).data(); if (!c || c.date !== t.iso) return;
        delete (c.st || {})[id]; c.scheduled = (c.scheduled || []).filter(s => s.key !== id); tx.set(ref, c);
      });
      await sleep(800); const c = await readToday();
      return { ok: c.date !== t.iso || !c.st?.[id] };
    }
    const ev = { doctor_id: id, name: A.shortName(d.name), kind: a.kind };
    if (a.kind === "starts_at") { ev.at_min = f; ev.until_min = u; }
    else if (["present", "leaves_at"].includes(a.kind)) { if (u != null) ev.until_min = u; else if (a.kind === "leaves_at" && at != null) ev.until_min = at; }
    else if (["late", "stop", "appointments_only"].includes(a.kind) && at != null) ev.at_min = at;
    if (a.kind === "late" && at == null) ev.delay_minutes = a.delay_minutes || 30;
    if (future) {
      ev.date = date;
      if (ev.at_min != null) ev.at_time = A.hhmm(ev.at_min);
      if (ev.until_min != null) ev.until_time = A.hhmm(ev.until_min);
      const same = i => i.doctorId === id && i.date === date && i.kind === a.kind && (ev.at_min == null || i.at_min === ev.at_min) && (ev.until_min == null || i.until_min === ev.until_min);
      if ((await readPlan()).some(same)) return { ok: true, note: "كان محفوظ من قبل" };
      // نفس الطبيب ونفس اليوم: الجديد يحل محل القديم (ما تتطبّق خطتين)
      await A.db.runTransaction(async tx => { const ref = A.db.doc("board/bawadi_plan"), c = (await tx.get(ref)).data() || {}; tx.set(ref, { ...c, items: (c.items || []).filter(i => !(i.doctorId === id && i.date === date && i.kind !== "set_schedule" && i.kind !== "remove_doctor")), at: Date.now() }); });
    }
    const done = await A.apply([ev], { text: "", by: BY, rep: [], confirmed: true, exact: true, admin: true });
    if (!done.length) return { ok: false, why: "ما انطبق" };
    await sleep(1000);
    if (future) { const items = await readPlan(); return { ok: items.some(i => i.doctorId === id && i.date === date && i.kind === a.kind && (ev.at_min == null || i.at_min === ev.at_min) && (ev.until_min == null || i.until_min === ev.until_min)) }; }
    const c = await readToday(), s = c.st?.[id];
    if (c.date !== t.iso || !s) return { ok: false, why: "ما لقيت الحالة في حالات اليوم" };
    if (!(STK[a.kind] || []).includes(s.kind) && !(a.kind === "appointments_only" && s.apptFrom != null)) return { ok: false, why: `المحفوظ «${ST_AR[s.kind] || s.kind}»` };
    if (a.kind === "starts_at" && (s.from !== f || (u != null && s.until !== u))) return { ok: false, why: `المحفوظ من ${A.hm(s.from)} لين ${s.until != null ? A.hm(s.until % 1440) : "—"}` };
    return { ok: true };
  }
  if (a.type === "cancel_plan") {
    const date = ISO(a.date) ? a.date : t.iso;
    await A.db.runTransaction(async tx => {
      const ref = A.db.doc("board/bawadi_plan"), tref = A.db.doc("board/bawadi_today");
      const c = (await tx.get(ref)).data() || {}, td = (await tx.get(tref)).data();
      tx.set(ref, { ...c, items: (c.items || []).filter(i => !(i.doctorId === id && i.date === date && i.kind !== "remove_doctor")), at: Date.now() });
      if (td?.events?.some(e => e.kind === "planned" && e.doctorId === id)) tx.set(tref, { ...td, events: td.events.filter(e => !(e.kind === "planned" && e.doctorId === id)) });   // تنبيه «🗓 بكرة» الغلط في الأداة
    });
    await sleep(800); const items = await readPlan();
    return { ok: !items.some(i => i.doctorId === id && i.date === date && i.kind !== "remove_doctor") };
  }
  if (a.type === "schedule") {
    const shifts = shiftsOf(a);
    const days = (a.days || []).filter(x => x >= 0 && x <= 6 && x !== 5);
    const sch = a.mode === "only_days" ? { days, shifts, altOnly: true } : a.mode === "set_days" ? { days, shifts } : { days: [], shifts };
    const from0 = ISO(a.start_date) && a.start_date > t.iso ? a.start_date : t.iso;
    if (a.mode !== "only_days" && (ISO(a.end_date) || a.until_return_of)) sch.tmp = { from: from0, until: ISO(a.end_date) ? a.end_date : "", back: ISO(a.end_date) ? "" : a.until_return_of };
    // نفس دوامه المسجّل بالضبط (وثابت) → ما نلمس شي
    if (!sch.tmp && !d.tmp && !sch.altOnly && sameSh(shifts, d.shifts) && (!days.length || JSON.stringify([...days].sort()) === JSON.stringify([...(d.workdays || [])].sort()))) return { ok: true, note: "نفس دوامه المسجّل — ما تغيّر شي" };
    if (ISO(a.start_date) && a.start_date > t.iso) {
      await A.db.doc("board/bawadi_plan").set({ items: A.FieldValue.arrayUnion({ id: A.uid(), date: a.start_date, doctorId: id, kind: "set_schedule", sch, by: BY }), at: Date.now() }, { merge: true });
      await sleep(800); return { ok: (await readPlan()).some(i => i.doctorId === id && i.date === a.start_date && i.kind === "set_schedule"), note: "ينطبق يومها" };
    }
    await A.updateSchedules([{ d, sch }], { by: BY });
    await sleep(1000); const { x } = await readBoardDoc(); if (!x) return { ok: false, why: "ما لقيته" };
    const J = v => JSON.stringify((v || []).map(y => [y.s, y.e]));
    if (sch.altOnly) return { ok: !!x.alt && days.every(i => x.alt.days.includes(i)) && J(x.alt.shifts) === J(shifts) || (J(x.shifts) === J(shifts) && !(x.alt?.days || []).some(i => days.includes(i))) };
    if (!shifts && !days.length) return { ok: false, why: "ما فيه شي يتغيّر" };
    const tmpOk = !sch.tmp || (!!x.tmp && (x.tmp.until || "") === sch.tmp.until && (x.tmp.back || "") === (sch.tmp.back || ""));
    return { ok: tmpOk && (!shifts || J(x.shifts) === J(shifts)) && (!days.length || JSON.stringify([...x.workdays].sort()) === JSON.stringify([...days].sort())), why: `المحفوظ ${(x.shifts || []).map(y => A.hm(y.s) + "–" + A.hm(y.e)).join("، ")}${sch.tmp && !x.tmp ? " (بدون «مؤقت»)" : ""}` };
  }
  if (a.type === "info") {
    const sch = { days: [], shifts: null, room: a.room || "", ext: a.ext || "", fee: String(a.fee || "").replace(/\D/g, "") };
    await A.updateSchedules([{ d, sch }], { by: BY });
    await sleep(1000); const { x } = await readBoardDoc();
    return { ok: !!x && ["room", "ext", "fee"].every(k => !sch[k] || String(x[k]) === sch[k]) };
  }
  if (a.type === "vacation") {
    await A.apply([{ doctor_id: id, name: A.shortName(d.name), kind: "vacation", start_date: a.start_date, end_date: a.end_date }], { text: "", by: BY, rep: [], confirmed: true, admin: true });
    await sleep(1000); const { b } = await readBoardDoc();
    return { ok: (b.vacations || []).some(v => v.doctorId === id && v.start <= a.start_date && (!v.end || v.end >= a.end_date)) };
  }
  if (a.type === "end_vacation") {
    await A.endVacations([{ d, day: a.return_date }], { by: BY });
    await sleep(1000); const { b } = await readBoardDoc();
    return { ok: !(b.vacations || []).some(v => (v.doctorId === id || (d.code && String(v.code) === String(d.code))) && v.start <= a.return_date && (!v.end || v.end >= a.return_date)) };
  }
  if (a.type === "add_doctor" || a.type === "pending_doctor") {
    let it;
    if (a.type === "pending_doctor") {
      const code = String(a.code || "").replace("#", "").toUpperCase(); it = pdocs.find(i => i.code === code);
      if (!it) return { ok: false, why: `ما لقيت #${code} في قائمة الانتظار` };
      await A.db.runTransaction(async tx => { const ref = A.db.doc("bot/pending_doctors"), c = (await tx.get(ref)).data() || {}; tx.set(ref, { items: (c.items || []).filter(i => i.code !== code) }); });
      if (a.decision !== "approve") { await sleep(600); const left = (await A.db.doc("bot/pending_doctors").get()).data()?.items || []; return { ok: !left.some(i => i.code === code) }; }
      it = { ...it };
    } else it = { name: String(a.name).replace(/^(د|دكتور|دكتوره)\.?\s+/, "").trim(), dept: a.dept || "", days: [], shifts: [], room: "", ext: "", fee: "" };
    if (a.dept) { it.dept = a.dept; it.depId = A.findDep(a.dept)?.id || ""; } else if (!it.depId) it.depId = A.findDep(it.dept)?.id || "";
    if (a.days?.length) it.days = a.days.filter(x => x >= 0 && x <= 6 && x !== 5);
    const f = toMin(a.from), u = toMin(a.until); if (f != null && u != null) it.shifts = [{ s: f, e: u }];
    for (const k of ["room", "ext", "fee"]) if (a[k]) it[k] = String(a[k]);
    const r = await A.addDoctor(it, BY);
    if (r === "exists") return { ok: true, note: "كان موجود أصلاً" };
    await sleep(1000); const b = (await A.db.doc("board/bawadi").get()).data() || {};
    const has = (b.departments || []).flatMap(p => p.doctors || []).some(x => A.norm(A.shortName(x.name)) === A.norm(it.name));
    return { ok: has, note: has && r ? "في " + r : "" };
  }
  if (a.type === "move_doctor") {
    const dep = A.findDep(a.dept);
    await A.db.runTransaction(async tx => {
      const ref = A.db.doc("board/bawadi"), prev = A.db.doc("board/bawadi_prev"), cur = (await tx.get(ref)).data(); if (!cur) return;
      const next = structuredClone(cur); let doc = null;
      for (const p of next.departments) { const i = (p.doctors || []).findIndex(x => x.id === id); if (i >= 0) doc = p.doctors.splice(i, 1)[0]; }
      const to = next.departments.find(p => p.id === dep.id); if (!doc || !to) return;
      (to.doctors ||= []).push(doc);
      next.departments = next.departments.filter(p => (p.doctors || []).length || p.notes);   // قسم فاضي (مثل «أخرى» الزايد) ينشال
      next.log = [{ at: Date.now(), by: BY, what: `نقل د. ${A.shortName(doc.name)} لقسم ${to.name}` }, ...(cur.log || [])].slice(0, 60); next.updatedAt = Date.now(); next.updatedBy = "البوت";
      tx.set(prev, { ...cur, savedAt: Date.now(), replacedBy: "نقل طبيب" }); tx.set(ref, next);
    });
    await sleep(1000); const b = (await A.db.doc("board/bawadi").get()).data() || {};
    return { ok: (b.departments || []).some(p => p.id === dep.id && (p.doctors || []).some(x => x.id === id)) };
  }
  if (a.type === "restore_doctor") {
    const items = (await A.db.doc("bot/removed_doctors").get()).data()?.items || [], r = items.filter(x => x.doc?.id === a.doctor_id).pop();
    if (!r) return { ok: false, why: "ما لقيته في الأطباء المشالين" };
    a.__name = A.shortName(r.doc.name);
    await A.db.runTransaction(async tx => {
      const ref = A.db.doc("board/bawadi"), prev = A.db.doc("board/bawadi_prev"), cur = (await tx.get(ref)).data(); if (!cur) return;
      const next = structuredClone(cur);
      if (next.departments.flatMap(p => p.doctors || []).some(x => x.id === r.doc.id)) return;
      let dep = next.departments.find(p => p.id === r.dep.id) || next.departments.find(p => p.name === r.dep.name);
      if (!dep) { dep = { id: r.dep.id, name: r.dep.name, floor: r.dep.floor || "G", notes: "", doctors: [] }; next.departments.push(dep); }
      (dep.doctors ||= []).push(r.doc);
      next.log = [{ at: Date.now(), by: BY, what: `رجّع د. ${a.__name} للجدول` }, ...(cur.log || [])].slice(0, 60); next.updatedAt = Date.now(); next.updatedBy = "البوت";
      tx.set(prev, { ...cur, savedAt: Date.now(), replacedBy: "إرجاع طبيب" }); tx.set(ref, next);
    });
    await sleep(1000); const b = (await A.db.doc("board/bawadi").get()).data() || {};
    return { ok: (b.departments || []).some(p => (p.doctors || []).some(x => x.id === r.doc.id)), note: "في " + r.dep.name };
  }
  if (a.type === "branch_day") {
    const br = String(a.branch || "").replace(/^(فرع|سابا)\s+/, "").trim(), days = (a.days || []).filter(x => x >= 0 && x <= 6 && x !== 5);
    await A.db.runTransaction(async tx => {
      const ref = A.db.doc("board/bawadi"), cur = (await tx.get(ref)).data(); if (!cur) return;
      const today = A.nowR().iso;
      if (days.length) { for (const p of cur.departments) for (const x of p.doctors || []) if (x.id === id) { const aw = { ...(x.away || {}) }; for (const w of days) { if (a.clear) delete aw[w]; else aw[w] = br; } x.away = aw; } }
      else { cur.awayDays = (cur.awayDays || []).filter(x => x.date >= today && !(x.doctorId === id && x.date === a.date)); if (!a.clear) cur.awayDays.push({ doctorId: id, date: a.date, branch: br, by: BY }); }
      cur.log = [{ at: Date.now(), by: BY, what: `د. ${A.shortName(d.name)}: ${a.clear ? "شال" : "في فرع " + br} ${days.length ? days.map(i => WD[i]).join(" و") : a.date}` }, ...(cur.log || [])].slice(0, 60); cur.updatedAt = Date.now(); cur.updatedBy = "البوت";
      tx.set(ref, cur);
    });
    await sleep(900); const { b, x } = await readBoardDoc(); if (!x) return { ok: false, why: "ما لقيت الطبيب" };
    if (days.length) return { ok: days.every(w => a.clear ? !x.away?.[w] : x.away?.[w] === br) };
    const has = (b.awayDays || []).some(y => y.doctorId === id && y.date === a.date && y.branch === br);
    return { ok: a.clear ? !(b.awayDays || []).some(y => y.doctorId === id && y.date === a.date) : has };
  }
  if (a.type === "remove_doctor") {
    if (ISO(a.start_date) && a.start_date > t.iso) {
      await A.db.doc("board/bawadi_plan").set({ items: A.FieldValue.arrayUnion({ id: A.uid(), date: a.start_date, doctorId: id, kind: "remove_doctor", by: BY }) }, { merge: true });
      await sleep(800); return { ok: (await readPlan()).some(i => i.doctorId === id && i.kind === "remove_doctor"), note: "يتشال يومها" };
    }
    await A.removeDoctor(id, "البوت (أنس)");
    await sleep(1000); const { x } = await readBoardDoc(); return { ok: !x };
  }
  if (a.type === "alias") {
    const al = String(a.alias || "").replace(/^(د|دكتور|دكتوره)\.?\s+/, "").trim().slice(0, 40); if (!al) return { ok: false, why: "الاسم فاضي" };
    await A.db.runTransaction(async tx => {
      const ref = A.db.doc("board/bawadi"), cur = (await tx.get(ref)).data(); if (!cur) return;
      for (const p of cur.departments) for (const x of p.doctors || []) if (x.id === id && !(x.aliases || []).some(y => A.norm(y) === A.norm(al))) x.aliases = [...(x.aliases || []), al].slice(-8);
      cur.log = [{ at: Date.now(), by: BY, what: `اسم ثاني لد. ${A.shortName(d.name)}: ${al}` }, ...(cur.log || [])].slice(0, 60); cur.updatedAt = Date.now(); cur.updatedBy = "البوت";
      tx.set(ref, cur);
    });
    await sleep(800); const { x } = await readBoardDoc(); return { ok: (x?.aliases || []).some(y => A.norm(y) === A.norm(al)) };
  }
  if (a.type === "remove_alias") {
    const al = A.norm(String(a.alias || "").replace(/^(د|دكتور|دكتوره)\.?\s+/, "").trim()); if (!al) return { ok: false, why: "الاسم فاضي" };
    await A.db.runTransaction(async tx => {
      const ref = A.db.doc("board/bawadi"), cur = (await tx.get(ref)).data(); if (!cur) return;
      for (const p of cur.departments) for (const x of p.doctors || []) if (x.id === id) x.aliases = (x.aliases || []).filter(y => A.norm(y) !== al);
      cur.log = [{ at: Date.now(), by: BY, what: `شلت الاسم الثاني «${a.alias}» من د. ${A.shortName(d.name)}` }, ...(cur.log || [])].slice(0, 60); cur.updatedAt = Date.now(); cur.updatedBy = "البوت";
      tx.set(ref, cur);
    });
    await sleep(800); const { x } = await readBoardDoc(); return { ok: !!x && !(x.aliases || []).some(y => A.norm(y) === al) };
  }
  if (a.type === "option") {
    const code = String(a.code || "").replace("#", "").toUpperCase(), it = pclar.find(i => i.code === code), o = it?.opts?.[(a.n || 0) - 1];
    if (!o) return { ok: false, why: `ما لقيت الخيار ${a.n} في #${code}` };
    await A.db.runTransaction(async tx => { const ref = A.db.doc("bot/pending_clarify"), c = (await tx.get(ref)).data() || {}; tx.set(ref, { items: (c.items || []).filter(i => i.code !== code) }); });
    let r = await A.applyOption(it, o).catch(e => ({ ok: false, why: String(e?.message || e) }));
    if (!r.ok && !r.none) r = await A.applyOption(it, o).catch(() => r);
    if (r.ok && !r.none && it.key?.id) { try { await A.getSock()?.sendMessage(it.key.remoteJid, { react: { text: "✅", key: { ...it.key, participant: it.key.participant || undefined } } }); } catch {} }
    return { ok: !!r.ok, why: r.why || "", note: r.none ? "تجاهلتها" : o.label };
  }
  if (a.type === "undo") { const ok = await A.restorePrev(true); return { ok: !!ok, why: ok ? "" : "ما فيه نسخة سابقة" }; }
  if (a.type === "reports") { A.setReports(!!a.on); return { ok: true }; }
  return { ok: false, why: "فعل غير معروف" };
}

/* ---------- تصحيحات مرة وحدة (7/11) — تنطبق أول ما يشتغل البوت وتتأكد من الموقع ---------- */
export async function bootFixes() {
  const ref = A.db.doc("bot/fixes_done"), doneIds = new Set((await ref.get()).data()?.ids || []);
  const t = A.nowR(), lines = [], mark = [];
  const wait = async () => { for (let i = 0; i < 20 && !A.docs().length; i++) await sleep(1000); };
  await wait();
  const byName = s => A.docs().find(d => A.norm(d.name).includes(A.norm(s)) || (d.aliases || []).some(x => A.norm(x).includes(A.norm(s))));
  // 1) أكرامي: دوام السبت 7/11 من 5م لين 9ص الأحد (كان محفوظ غلط بكرة الأحد 5م–9م)
  if (!doneIds.has("fx0711ak")) {
    const d = A.docs().find(x => x.id === "g62723r") || byName("كرامي");
    const end = Date.parse("2026-11-08T09:00:00+03:00");
    if (d && Date.now() < end) {
      const items = (await A.db.doc("board/bawadi_plan").get()).data()?.items || [];
      const wrong = items.filter(i => i.doctorId === d.id && i.date === "2026-11-08" && i.kind !== "set_schedule" && i.kind !== "remove_doctor");
      const pclar = []; const out = [];
      if (wrong.length) out.push(...await execute([{ type: "cancel_plan", doctor_id: d.id, date: "2026-11-08" }], pclar, []));
      const act = { type: "status", doctor_id: d.id, kind: "starts_at", date: "2026-11-07", from: "17:00", until: "09:00", until_next_day: true };   // بعد 12 الليل: run() يحط جزء الأحد (12ص–9ص)
      out.push(...await execute([act], pclar, []));
      lines.push(`د. أكرامي:${wrong.length ? ` لقيت محفوظ بكرة الأحد (${wrong.map(i => (i.at_time || "") + "–" + (i.until_time || "")).join("، ")})` : " ما لقيت خطة الأحد الغلط"}\n${out.join("\n")}`);
      if (!out.some(l => /^(❌|⚠️)/.test(l))) mark.push("fx0711ak");
    } else if (d) mark.push("fx0711ak");
  }
  // 3) أمينة الحلواني: ترجع لقائمة الانتظار (انحذفت بالغلط من «لا + كلام»)
  if (!doneIds.has("fx0711am")) {
    const inBoard = byName("الحلواني");
    const pd = (await A.db.doc("bot/pending_doctors").get()).data()?.items || [];
    if (inBoard) { lines.push(`د. أمينة الحلواني: موجودة في الجدول (${inBoard.dep}) — ما يحتاج ترجع للانتظار.`); mark.push("fx0711am"); }
    else if (pd.some(i => /حلوان/.test(A.norm(i.name)))) { lines.push("د. أمينة الحلواني: موجودة في قائمة الانتظار ✓"); mark.push("fx0711am"); }
    else {
      const [ib, pc] = await Promise.all([A.db.doc("board/bawadi_inbox").get(), A.db.doc("bot/pending_clarify").get()]);
      const src = [...(ib.data()?.items || []), ...(pc.data()?.items || []), ...A.groupLog()].reverse().find(x => /حلوان/.test(A.norm(x.text || x.name || "")));
      let ok = false;
      if (src?.text) {
        const evs = (await A.aiParse(src.text, "")) || [];
        const e = evs.find(x => x.kind === "new_doctor" && /حلوان/.test(A.norm(x.name))) || { name: "أمينة الحلواني", dept: src.dept || "", kind: "new_doctor" };
        const f0 = toMin(e.from_time), u0 = toMin(e.to_time);
        await A.askAdmin({ e, sch: { days: (e.days || []).filter(x => x !== 5), shifts: f0 != null && u0 != null ? [{ s: f0, e: u0 }] : [], room: e.room || "", ext: e.ext || "", fee: String(e.fee || "").replace(/\D/g, "") } }, { text: src.text, by: src.by || "القروب" });
        await sleep(800); ok = ((await A.db.doc("bot/pending_doctors").get()).data()?.items || []).some(i => /حلوان/.test(A.norm(i.name)));
        lines.push(ok ? "د. أمينة الحلواني: رجّعتها لقائمة الانتظار ✓ (رسالة الإضافة فوق — رد عليها أو قل لي بكلامك)" : "❌ د. أمينة الحلواني: ما قدرت أرجّعها للانتظار");
      } else lines.push("د. أمينة الحلواني: ما لقيت رسالتها الأصلية عندي — حوّل لي رسالة القروب حقتها (أو اكتب قسمها ودوامها) وأتصرف.");
      if (ok || !src?.text) mark.push("fx0711am");
    }
  }
  // 4) (2.10.2) أمينة الحلواني → قسم الأطفال، و«أمينه» تنشال من أسماء د. سحر (انربطت غلط من رسالة القروب)
  if (!doneIds.has("fx0711am2")) {
    const am = A.docs().find(x => x.id === "5r64m1l") || byName("الحلواني"), sa = A.docs().find(x => x.id === "nsvukis");
    const acts = [];
    if (am && !/أطفال/.test(am.dep)) acts.push({ type: "move_doctor", doctor_id: am.id, dept: "الأطفال" });
    if (sa && (sa.aliases || []).some(y => /^امين/.test(A.norm(y)))) for (const y of sa.aliases.filter(y => /^امين/.test(A.norm(y)))) acts.push({ type: "remove_alias", doctor_id: sa.id, alias: y });
    if (acts.length) { const out = await execute(acts, [], []); lines.push(`د. أمينة الحلواني / د. سحر محمد:\n${out.join("\n")}`); if (!out.some(l => /^(❌|⚠️)/.test(l))) mark.push("fx0711am2"); }
    else mark.push("fx0711am2");
  }
  // 5) (2.10.3 — «ابدأ» 7/11) د. مدحت عبدالحكيم ترك سابا → ينشال، نورة اليامي → قسم الأسنان (الاسم يظل)، واسم صحة + فرع الترخيص لكل طبيب
  if (!doneIds.has("fx0711seha")) {
    const acts = [], out = [];
    const md = A.docs().find(x => x.id === "3l52c9c") || byName("مدحت عبدالحكيم");
    if (md) acts.push({ type: "remove_doctor", doctor_id: md.id });
    const nr = A.docs().find(x => x.id === "psaved4") || byName("نورة اليامي");
    if (nr && !/اسنان/.test(A.norm(nr.dep))) acts.push({ type: "move_doctor", doctor_id: nr.id, dept: "الأسنان" });
    if (acts.length) out.push(...await execute(acts, [], []));
    let n = 0;
    try {
      const list = JSON.parse((await import("node:fs")).readFileSync(new URL("./seha-names.json", import.meta.url), "utf8"));
      await A.db.runTransaction(async tx => {
        const bref = A.db.doc("board/bawadi"), cur = (await tx.get(bref)).data(); if (!cur) return;
        for (const p of cur.departments) for (const x of p.doctors || []) { const e = list.find(l => l.id === x.id); if (e) { x.sehaName = e.seha; x.sehaBranch = e.branch; } }
        cur.log = [{ at: Date.now(), by: BY, what: "اسم صحة وفرع الترخيص لكل طبيب" }, ...(cur.log || [])].slice(0, 60); cur.updatedAt = Date.now(); cur.updatedBy = "البوت";
        tx.set(bref, cur);
      });
      await sleep(1000);
      const b = (await A.db.doc("board/bawadi").get()).data() || {}, all = (b.departments || []).flatMap(p => p.doctors || []);
      n = all.filter(x => list.some(l => l.id === x.id && x.sehaName === l.seha)).length;
      const miss = all.filter(x => !x.sehaName).map(x => A.shortName(x.name));
      out.push(`${n ? "✅" : "❌"} اسم صحة انحفظ لـ ${n} طبيب${miss.length ? ` — بدون اسم صحة: ${miss.join("، ")}` : ""}`);
    } catch (e) { out.push("❌ أسماء صحة ما انحفظت: " + String(e?.message || e).slice(0, 100)); }
    lines.push(`الجدول (مدحت، نورة، أسماء صحة):\n${out.join("\n")}`);
    if (n && !out.some(l => /^(❌|⚠️)/.test(l))) mark.push("fx0711seha");
  }
  // 6) (2.12.2) د. هيام حلمي: ترخيصها صار تحت وطنك
  if (!doneIds.has("fx0811hy")) {
    await A.db.runTransaction(async tx => {
      const bref = A.db.doc("board/bawadi"), cur = (await tx.get(bref)).data(); if (!cur) return;
      for (const p of cur.departments) for (const x of p.doctors || []) if (x.id === "u4eikim") x.sehaBranch = "watanak";
      cur.log = [{ at: Date.now(), by: BY, what: "د. هيام حلمي: فرع الترخيص وطنك" }, ...(cur.log || [])].slice(0, 60); cur.updatedAt = Date.now(); cur.updatedBy = "البوت";
      tx.set(bref, cur);
    });
    await sleep(800);
    const ok = ((await A.db.doc("board/bawadi").get()).data()?.departments || []).flatMap(p => p.doctors || []).some(x => x.id === "u4eikim" && x.sehaBranch === "watanak");
    lines.push(ok ? "✅ د. هيام حلمي: فرع الترخيص صار وطنك (إجازاتها تروح لحساب وطنك في صحة)" : "❌ د. هيام حلمي: فرع الترخيص ما تغيّر");
    if (ok) mark.push("fx0811hy");
  }
  // 7) (2.13.0) د. كريم شديد انشال بالغلط 9/11 (كان المقصود «الإثنين في الصفا والثلاثاء في السليمانية») → يرجع من نسخة ما قبل الحذف
  if (!doneIds.has("fx0911kr")) {
    if (A.docs().some(x => x.id === "nlf1lpm" || /كريم شديد/.test(x.name))) { mark.push("fx0911kr"); lines.push("د. كريم شديد: موجود في الجدول ✓ (ما يحتاج إرجاع)"); }
    else {
      const prevB = (await A.db.doc("board/bawadi_prev").get()).data() || {};
      let found = null; for (const p of prevB.departments || []) for (const x of p.doctors || []) if (x.id === "nlf1lpm") found = { dep: { id: p.id, name: p.name, floor: p.floor }, doc: x };
      if (!found) { const rm = ((await A.db.doc("bot/removed_doctors").get()).data()?.items || []).find(x => x.doc?.id === "nlf1lpm"); if (rm) found = rm; }
      if (found) {
        await A.db.runTransaction(async tx => { const r = A.db.doc("bot/removed_doctors"), c = (await tx.get(r)).data() || {}; tx.set(r, { items: [...(c.items || []).filter(x => x.doc?.id !== "nlf1lpm"), { at: Date.now(), by: "إصلاح", ...found }] }); });
        const out = await execute([{ type: "restore_doctor", doctor_id: "nlf1lpm" }], [], []);
        lines.push(`د. كريم شديد (انشال بالغلط):\n${out.join("\n")}`); if (!out.some(l => /^(❌|⚠️)/.test(l))) mark.push("fx0911kr");
      } else lines.push("❌ د. كريم شديد: ما لقيت نسخته — قل لي قسمه ودوامه وأرجّعه");
    }
  }
  // 8) (2.13.1) د. أمينة الحلواني: دوامها الثابت السبت–الخميس 12م–8م (طلبه أنس 9/11 والبوت قال انحفظ وما انحفظ)
  if (!doneIds.has("fx0911am3")) {
    const am = A.docs().find(x => x.id === "5r64m1l");
    if (am) { const out = await execute([{ type: "schedule", doctor_id: am.id, mode: "set_days", days: [6, 0, 1, 2, 3, 4], from: "12:00", until: "20:00" }], [], []); lines.push(`د. أمينة الحلواني:\n${out.join("\n")}`); if (!out.some(l => /^(❌|⚠️)/.test(l))) mark.push("fx0911am3"); }
    else mark.push("fx0911am3");
  }
  // 9) (2.16.1) الطب العام — دوام ثابت (رسالة ماجد #R6Q، وأنس قال 17/11 «الدوامات هذي بتكون ثابتة» والبوت ما حفظها: الأوقات ما وصلت للذكاء)
  if (!doneIds.has("fx1911gp")) {
    const want = [["gguqlrc", "مجدي نصيف", "09:00", "17:00"], ["bxm6z5u", "سارة الجارحي", "12:00", "20:00"], ["g62723r", "كرامي", "17:00", "01:00"], ["zdrud94", "السنجيدي", "01:00", "09:00"]];
    const acts = [], miss = [];
    for (const [id, nm, f, u] of want) { const d = A.docs().find(x => x.id === id) || byName(nm); if (d) acts.push({ type: "schedule", doctor_id: d.id, mode: "all_days", from: f, until: u }); else miss.push(nm); }
    const out = acts.length ? await execute(acts, [], []) : [];
    lines.push(`الطب العام — الدوام الثابت (طلبك 17/11 اللي ما انحفظ):\n${out.join("\n")}${miss.length ? "\n❌ ما لقيت: " + miss.join("، ") : ""}`);
    if (!miss.length && !out.some(l => /^(❌|⚠️)/.test(l))) mark.push("fx1911gp");
  }
  // 10) (2.16.1) إجازات طلبها المدير في قروب الشكاوي 19/11 وما انحفظت («ناقص تاريخ» — الذكاء كتب التاريخ 23-11-2026 بدل 2026-11-23)
  if (!doneIds.has("fx1911vac")) {
    const want = [["علياء", "2026-11-23", "2026-11-27"], ["كريم شديد", "2026-11-23", "2026-11-27"], ["مجد العدواني", "2026-11-23", "2026-11-28"], ["كرامي", "2026-11-23", "2026-11-25"]];
    const vacs = (await A.db.doc("board/bawadi").get()).data()?.vacations || [];
    const acts = [], have = [], miss = [];
    for (const [nm, s0, e0] of want) {
      const d = byName(nm); if (!d) { miss.push(nm); continue; }
      if (vacs.some(v => v.doctorId === d.id && v.start <= s0 && (!v.end || v.end >= e0))) { have.push("د. " + A.shortName(d.name)); continue; }
      acts.push({ type: "vacation", doctor_id: d.id, start_date: s0, end_date: e0 });
    }
    const out = acts.length ? await execute(acts, [], []) : [];
    lines.push(`إجازات قروب الشكاوي (23/11):\n${[...out, have.length ? "✅ محفوظة من قبل: " + have.join("، ") : "", miss.length ? "❌ ما لقيت: " + miss.join("، ") : ""].filter(Boolean).join("\n")}`);
    if (!miss.length && !out.some(l => /^(❌|⚠️)/.test(l))) mark.push("fx1911vac");
  }
  // 11) (2.18.3) قروب الشكاوي 19/11 — أنس: «تامر دوامه ١-٩، اليوم آخر يوم، والهام ترجع السبت» (البوت قراها وما طبّقها)
  if (!doneIds.has("fx1911tamer")) {
    const t0 = A.nowR(), acts = [], miss = [];
    const tamer = byName("تامر"), elham = byName("إلهام") || byName("الهام");
    if (tamer && t0.iso === "2026-11-19" && t0.m < 21 * 60) acts.push({ type: "status", doctor_id: tamer.id, kind: "starts_at", date: "2026-11-19", from: "13:00", until: "21:00" }); else if (!tamer) miss.push("تامر");
    const ev = elham && (A.getBoard()?.vacations || []).find(v => v.doctorId === elham.id && (!v.end || v.end >= "2026-11-20"));
    if (ev && ev.end !== "2026-11-20") acts.push({ type: "end_vacation", doctor_id: elham.id, return_date: "2026-11-21" }); else if (!elham) miss.push("إلهام");
    const out = acts.length ? await execute(acts, [], []) : [];
    if (acts.length || miss.length) lines.push(`قروب الشكاوي (تامر وإلهام):\n${[...out, miss.length ? "❌ ما لقيت: " + miss.join("، ") : ""].filter(Boolean).join("\n")}`);
    if (!out.some(l => /^(❌|⚠️)/.test(l))) mark.push("fx1911tamer");
  }
  if (mark.length) await ref.set({ ids: [...doneIds, ...mark], at: Date.now() }, { merge: true });
  if (lines.length) await A.dmAdmin(`🔧 تصحيحات بعد التحديث:\n\n${lines.join("\n\n")}`);
  // 12) (2.19.0) مراجعة لمرة وحدة: الجدول الثابت مقابل اللي انقال في القروبين (المحفوظ عندي) — بدون ما نغيّر شي
  if (!doneIds.has("au2119") && A.gemini) {
    await sleep(20000);
    const { system } = await buildCtx();
    const q = "[النظام — مراجعة لمرة وحدة، مو كلام أنس] قارن «جدول أطباء البوادي» (عمود الدوام الثابت) بكل اللي انقال في «آخر رسايل القروب» و«قروب الشكاوي» و«حالات اليوم» و«الخطط». اكتب في reply قائمة الأطباء اللي دوامهم الثابت بالجدول يختلف عن اللي انقال (كل طبيب سطر: د. الاسم — بالجدول: … — انقال: … (مين ومتى)). لا تحط الأطباء اللي الكلام عنهم ليوم واحد بس واضح. لو ما فيه اختلاف قل كذا. actions فاضية.";
    const out = await callAI(system, [{ role: "user", parts: [{ text: q }] }], { temp: 0 }).catch(() => null);
    if (out?.reply) {
      await A.dmAdmin(`🔎 مراجعة الجدول مقابل رسايل القروبين (اللي محفوظ عندي: آخر يومين تقريباً من قروب الاستقبال و3 أيام من قروب الشكاوي):\n\n${String(out.reply).slice(0, 1800)}\n\nلو تبغى أعدّل أحد قل لي اسمه ودوامه (ولمدة كم).`);
      await ref.set({ ids: [...doneIds, ...mark, "au2119"], at: Date.now() }, { merge: true });
    }
  }
}

/* ---------- (2.16.1) اختبار الفهم: البوت يجرّب نفسه على رسايل صعبة بعد كل تحديث — بدون ما يحفظ شي ---------- */
// كل حالة: نص (و«يرد على» لو فيه) + المتوقّع. النتيجة تنحفظ في board/bawadi_selftest (بدون بيانات مراجعين) وسطر واحد لأنس.
function selfCases() {
  const t = A.nowR(), D = n => A.isoPlus(t.iso, n), wd = w => D(((w - t.wd + 7) % 7) || 7), WDA = ["الاحد", "الاثنين", "الثلاثاء", "الاربعاء", "الخميس", "الجمعه", "السبت"];
  const R6Q = `✅ قريت رسالة #R6Q  Majed:\n«سابا 1\nمن غدا الثلاثاء ستكون عيادة الطب العام كالاتي :\nد.مجدي نصيف ٩-٥\nد.سارة الشوربجي ١٢م-٨م\nد.اكرامي الشرقاوي من ٥-١\nد.اشرف السنجيدي من ١ص-٩ص»\n\nاللي سويته:\n📅 د. مجدي نصيف — بكرة: دوامه من 9ص إلى 5م\n📅 د. سارة الجارحي — بكرة: دوامه من 12م إلى 8م\n📅 د. أكرامي الشرقاوي — بكرة: دوامه من 5م إلى 1ص\n📅 د. أشرف السنجيدي — بكرة: دوامه من 1ص إلى 9ص`;
  return [
    { q: "اكرا وقف", all: [{ doc: "كرامي", type: "status", kind: ["stop"], date: D(0) }] },
    { q: "اكرامي وقف استقبال", all: [{ doc: "كرامي", type: "status", kind: ["stop"] }] },
    { q: "وقف استقبال نشوى الساعه ٨ بالليل", all: [{ doc: "نشوى", type: "status", kind: ["stop"], at: "20:00" }] },
    { q: "رشا مواعيد بس", all: [{ doc: "الوزيري", type: "status", kind: ["appointments_only"] }] },
    { q: "الوزري زحمه مره", all: [{ doc: "الوزيري", type: "status", kind: ["busy"] }] },
    { q: "منال مو جايه اليوم", all: [{ doc: "منال", type: "status", kind: ["absent_today"], date: D(0) }] },
    { q: "دكتوره رشا مش جايه النهارده", all: [{ doc: "الوزيري", type: "status", kind: ["absent_today"], date: D(0) }] },
    { q: "نشوى بتتاخر ساعه", all: [{ doc: "نشوى", type: "status", kind: ["late"] }] },
    { q: "مجدي بكره اجازه", any: [{ doc: "مجدي", type: "status", kind: ["absent_today"], date: D(1) }, { doc: "مجدي", type: "vacation", start: D(1), end: D(1) }] },
    { q: "الشرقاوي من ٢٣ الى ٢٥ يرجع ٢٦", all: [{ doc: "كرامي", type: "vacation", start: "2026-11-23", end: "2026-11-25" }], until: "2026-11-23" },
    { q: "اجازة مجد العدواني من 23 ل 28", all: [{ doc: "مجد العدواني", type: "vacation", start: "2026-11-23", end: "2026-11-28" }], until: "2026-11-23" },
    { q: "عليا وكريم شديد اجازه 23 الى 27", all: [{ doc: "علياء", type: "vacation", start: "2026-11-23", end: "2026-11-27" }, { doc: "كريم شديد", type: "vacation", start: "2026-11-23", end: "2026-11-27" }], until: "2026-11-23" },
    { q: "دوام مجدي بكرة من 9 الصبح لين 5 العصر", all: [{ doc: "مجدي", type: "status", kind: ["starts_at"], date: D(1), from: "09:00", until: "17:00" }] },
    { q: "سارة الشوربجي دوامها ثابت ١٢م-٨م", all: [{ doc: "سارة الجارحي", type: "schedule", from: "12:00", until: "20:00" }] },
    { q: "الدوامات هذي بتكون ثابته للايام القادمه", quoted: R6Q, all: [
      { doc: "مجدي", type: "schedule", from: "09:00", until: "17:00" }, { doc: "سارة الجارحي", type: "schedule", from: "12:00", until: "20:00" },
      { doc: "كرامي", type: "schedule", from: "17:00", until: "01:00" }, { doc: "السنجيدي", type: "schedule", from: "01:00", until: "09:00" }] },
    { q: "خلها ثابته", quoted: R6Q, all: [{ doc: "مجدي", type: "schedule", from: "09:00", until: "17:00" }, { doc: "كرامي", type: "schedule", from: "17:00", until: "01:00" }] },
    { q: "مجدي اجازه بكره واكرامي يغطي عنه من ٩ الصبح لين ٥ العصر", all: [{ doc: "كرامي", type: "status", kind: ["starts_at"], date: D(1), from: "09:00", until: "17:00" }], any: [{ doc: "مجدي", type: "status", kind: ["absent_today"], date: D(1) }, { doc: "مجدي", type: "vacation", start: D(1) }] },
    { q: "اشرف السنجيدي الخميس الجاي من ٥ العصر لين ١ بالليل", all: [{ doc: "السنجيدي", type: "status", kind: ["starts_at"], date: wd(4), from: "17:00", until: "01:00" }] },
    { q: "ولاء طلعت", any: [{ doc: "ولاء", type: "status", kind: ["absent_today", "leaves_at"] }] },
    { q: "الغي حالة نشوى ورجعها لجدولها", all: [{ doc: "نشوى", type: "status", kind: ["clear"] }] },
    { q: "عبدالحليم موجود", all: [{ doc: "عبدالحليم", type: "status", kind: ["present"] }] },
    { q: "نيرمين بكرا تبدا ١٠ الصبح لين ٢ الظهر", all: [{ doc: "نيرمين", type: "status", kind: ["starts_at"], date: D(1), from: "10:00", until: "14:00" }] },
    { q: "اسامه يوسف السبت مايجي", all: [{ doc: "أسامة", type: "status", kind: ["absent_today"], date: wd(6) }] },
    { q: "منال دوامها صار من ٨ الصبح لين ٤ العصر كل يوم", all: [{ doc: "منال", type: "schedule", from: "08:00", until: "16:00" }] },
    { q: "[رسالة محوّلة من قروب الاستقبال]\nد.مجدي نصيف بكره ٩ص-٥م", all: [{ doc: "مجدي", type: "status", kind: ["starts_at"], date: D(1), from: "09:00", until: "17:00" }] },
    // (2.19.0) فترتين + مؤقت + «بداية من»
    { q: "د سحر دوامها ثابت من 9 am الى 1 pm و من 5 pm الى 9 pm", all: [{ doc: "سحر", type: "schedule", shifts: [["09:00", "13:00"], ["17:00", "21:00"]] }] },
    { q: "د سحر شفتين من ١٠ ص الى ١ م ومن ٥ م الى ٩:٣٠ ثابت", all: [{ doc: "سحر", type: "schedule", shifts: [["10:00", "13:00"], ["17:00", "21:30"]] }] },
    { q: "منال من ٨ الصبح لين ٤ العصر لمدة اسبوع", all: [{ doc: "منال", type: "schedule", from: "08:00", until: "16:00", endIn: D(6) }] },
    { q: "د ساره من 5 pm الى 1 am لين يرجع اكرامي", all: [{ doc: "سارة الجارحي", type: "schedule", from: "17:00", until: "01:00", back: "كرامي" }] },
    { q: `بداية من يوم ${WDA[(t.wd + 2) % 7 === 5 ? 6 : (t.wd + 2) % 7]}\nد ساره من 5 pm الى 1 am`, all: [{ doc: "سارة الجارحي", type: "schedule", from: "17:00", until: "01:00", startIn: wd((t.wd + 2) % 7 === 5 ? 6 : (t.wd + 2) % 7) }] },
    { q: "جهز لي رساله التغييرات ليوم الجمعه وتغييرات الاسبوع القادم", draft: true },
    { q: "جهز لي رساله بدوام الجمعه", draft: true },
    { q: "شكرا", none: true },
    { q: "كيف الحال", none: true },
  ].filter(c => !c.until || t.iso < c.until);
}
function hitSpec(a, sp) {
  const d = A.docs().find(x => A.norm(x.name).includes(A.norm(sp.doc)) || (x.aliases || []).some(y => A.norm(y).includes(A.norm(sp.doc))));
  if (!d || a.doctor_id !== d.id || a.type !== sp.type) return false;
  if (sp.kind && !sp.kind.includes(a.kind)) return false;
  if (sp.date && (a.date || A.nowR().iso) !== sp.date) return false;
  if (sp.start && a.start_date !== sp.start) return false;
  if (sp.end && a.end_date !== sp.end) return false;
  if (sp.from && toMin(a.from) !== toMin(sp.from)) return false;
  if (sp.until && toMin(a.until) !== toMin(sp.until)) return false;
  if (sp.at && toMin(a.at) !== toMin(sp.at)) return false;
  if (sp.shifts && JSON.stringify((shiftsOf(a) || []).map(x => [x.s, x.e])) !== JSON.stringify(sp.shifts.map(([f, u]) => [toMin(f), toMin(u)]))) return false;
  if (sp.back) { const bd = A.docs().find(x => A.norm(x.name).includes(A.norm(sp.back))); if (!bd || a.until_return_of !== bd.id) return false; }
  if (sp.endIn && a.end_date !== sp.endIn) return false;
  if (sp.startIn && a.start_date !== sp.startIn) return false;
  return true;
}
export async function selfTest(version) {
  if (!A?.gemini) return;
  const ref = A.db.doc("board/bawadi_selftest"), prev = (await ref.get()).data() || {};
  if (prev.version === version) return;                                      // مرة وحدة لكل نسخة
  const { system } = await buildCtx(), res = [];
  for (const c of selfCases()) {
    const user = (c.quoted ? `[يرد على: «${c.quoted.slice(0, 2500)}»]\n` : "") + c.q;
    let out = await callAI(system, [{ role: "user", parts: [{ text: user }] }]).catch(() => null);
    let acts = out ? prepActs(out, c.q, c.quoted || "") : [];
    if (out && acts.some(a => check(a))) {                                    // نفس المحاولة الثانية اللي يسويها مع أنس
      const fix = await callAI(system, [{ role: "user", parts: [{ text: user }] }, { role: "model", parts: [{ text: JSON.stringify({ understood: out.understood, reply: out.reply, actions: out.actions }) }] },
        { role: "user", parts: [{ text: "[النظام] الأفعال هذي ناقصة:\n" + acts.map(a => [a, check(a)]).filter(([, w]) => w).map(([a, w]) => `- ${a.type}: ${w}`).join("\n") + "\nأعد قراءة الكلام والرسالة المقتبسة، اكتب understood من جديد، ورجّع actions كاملة." }] }], { models: [...A.models].reverse(), temp: 0 }).catch(() => null);
      if (fix) { const fa = prepActs(fix, c.q, c.quoted || ""); if (fa.filter(a => check(a)).length < acts.filter(a => check(a)).length || !fa.some(a => check(a))) { out = fix; acts = fa; } }
    }
    const good = acts.filter(a => !check(a));
    const ok = !out ? false : c.draft ? !acts.length && String(out.reply || "").length > 120 && /\d{1,2}[\/-]\d{1,2}|الجمعة|الجمعه/.test(out.reply || "") : c.none ? !acts.length : (c.all || []).every(sp => good.some(a => hitSpec(a, sp))) && (!c.any || c.any.some(sp => good.some(a => hitSpec(a, sp))));
    res.push({ q: c.q.slice(0, 160), ok, understood: String(out?.understood || "").slice(0, 300), got: good.map(describe).join(" | ").slice(0, 400), bad: acts.filter(a => check(a)).map(a => check(a)).join(" | ").slice(0, 300), model: out?.__model || "" });
    await sleep(6000);                                                        // بهدوء — حدود Gemini المجانية
  }
  const n = res.filter(r => r.ok).length;
  await ref.set({ version, at: Date.now(), pass: n, total: res.length, results: res });
  await A.dmAdmin(`🧪 جرّبت فهمي بعد التحديث على ${res.length} رسالة صعبة (بدون ما أحفظ شي): فهمت ${n} صح.${n < res.length ? "\nاللي ما فهمتها انحفظت لـ Claude يصلّحها:\n" + res.filter(r => !r.ok).slice(0, 6).map(r => "• " + r.q.split("\n").pop().slice(0, 70)).join("\n") : ""}`);
}
export const _t = { durOf, shiftsOf, fillShifts, prepActs, pickOpt, withDur, check, describe, askDurText, timesIn, fillBack };
