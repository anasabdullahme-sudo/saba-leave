// (2.10.0) الخاص مع أنس: كل رسالة منه (رد، محوّلة، كلام عادي) تروح للذكاء مع كل السياق
// (جدول الأطباء، حالات اليوم وبكرة، آخر رسايل القروب، الطلبات المنتظرة، آخر كلامنا).
// الذكاء يرد بكلام طبيعي ويقول وش فهم، ويسأل لو مو متأكد، ويطلب «أفعال» لو الشي واضح.
// الكود هو اللي ينفّذ الأفعال، ويقرا التغيير من القاعدة، وبعدها بس يقول «انحفظ».
// القروب ما يتغيّر: ✅ بس.

let A = null;                                   // أدوات group.js (تنمرّر من initBrain)
const chat = [];                                // آخر كلامنا {role: user|model, text, at}
let saveT = null, proposal = null;              // اقتراح ينتظر موافقته

export function initBrain(api) {
  A = api;
  A.db.doc("bot/admin_chat").get().then(d => {
    const old = (d.data()?.msgs || []).filter(x => Date.now() - x.at < 24 * 3600e3);
    chat.unshift(...old); chat.sort((a, b) => a.at - b.at); trim();
    proposal = d.data()?.proposal && Date.now() - d.data().proposal.at < 6 * 3600e3 ? d.data().proposal : null;
  }).catch(() => {});
}
const trim = () => { while (chat.length > 24) chat.shift(); };
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => A.db.doc("bot/admin_chat").set({ msgs: chat.slice(-24), proposal: proposal || null, at: Date.now() }).catch(() => {}), 3000);
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
    d.room ? "غرفة " + d.room : "", d.fee ? "كشفية " + d.fee : ""].filter(Boolean).join(" | ")).join("\n");
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

كيف تشتغل:
- افهم قصده من كلامه ومن السياق كله: المحادثة، الرسالة اللي يرد عليها، رسايل القروب الأخيرة، الطلبات المنتظرة، والجدول.
- في reply قل وش فهمت بالضبط (الطبيب، اليوم والتاريخ، الوقت) ووش بتسوي — بصيغة المستقبل («بعدّل…»، «بحط…»)، مو الماضي، لأن التنفيذ يصير بعد ردك.
- قبل أي فعل شيك على حالات اليوم والخطط والجدول: لو الشي المطلوب موجود أصلاً قل له إنه موجود وبدون أفعال.
- «فقط/بس السبت» أو «هذا السبت» أو يوم معيّن بدون «كل/دائم/ثابت» = يوم واحد (status)، مو دوام ثابت.
- الشي واضح؟ حط الأفعال في actions وطبّق على طول. مو متأكد من شي يغيّر النتيجة (مين الطبيب، أي يوم، الوقت، ليوم واحد ولا دائم)؟ اسأله سؤال واحد واضح و actions فاضية.
- تغيير كبير (دوام ثابت، إضافة/حذف طبيب، تراجع) وأنت فاهمه من كلامه الصريح → طبّق. لو فاهمه من استنتاجك أو من رسالة قروب محوّلة بس → confirm_first = true و actions = اللي بتسويه، واسأله «أطبّق؟».
- لو عندك «اقتراح ينتظر موافقته» ووافق («ايوه/طبق/تمام») → use_proposal = true. لو عدّل عليه → اكتب الأفعال الجديدة كاملة.
- سؤال (متى دوامه؟ ليش سويت كذا؟ وش صار؟) → جاوب من البيانات بس، بدون أفعال. لو أخطأت قبل، اعترف بجملة واقترح التصحيح.
- تصحيح لشي انحفظ غلط → صحّح الحالة النهائية كاملة (مثلاً: ألغِ الخطة الغلط بـ cancel_plan، وحط الصح).
- رسالة محوّلة من القروب = كلام الاستقبال؛ افهمها زي رسالة قروب وطبّق اللي فيها (التغييرات اليومية على طول، الدائمة بتأكيد).
- لا تكتب أبداً «انحفظ» أو «تم» أو «حفظت» أو ✅ — النظام يقرا الموقع بعد التنفيذ ويضيف النتيجة بنفسه.
- لا تخترع أوقات أو أيام أو أرقام ما انقالت. الأوقات بصيغة 24 ساعة HH:MM. في العيادة 1–7 بدون ص/م غالباً مساءً، و8–11 حسب دوام الطبيب.
- الدوام اللي يعدّي نص الليل (مثل 5 العصر لين 9 الصبح): date = يوم البداية، start_time = 17:00، end_time = 09:00، و until_next_day = true. لا تحطه على اليوم اللي بعده.
- بعد 12 بالليل ولين 5 الفجر، «بكرة» و«الليلة» ممكن تعني يومين — لو ما وضّح اسأل باسم اليوم.
- لا تضيف طبيب ما انذكر في القروب أو ما طلبه أنس صراحة.

الأفعال (type):
كل الأوقات في start_time / end_time / at_time بصيغة "HH:MM" أرقام إنجليزية 24 ساعة (مثل "12:00" و "20:00") — لا تحطها في reply بس، لازم في الحقول.
- status: حالة ليوم واحد (اليوم أو يوم جاي خلال أسبوعين). kind واحد من: starts_at (دوام ذاك اليوم: start_time و end_time — الاثنين لازم)، present (موجود، end_time اختياري)، leaves_at (يطلع الساعة end_time)، late (يوصل الساعة at_time أو delay_minutes)، stop (وقف استقبال، at_time لو بوقت جاي)، free، appointments_only (at_time = من متى مواعيد فقط)، busy، absent_today (غير متواجد ذاك اليوم)، clear (يشيل حالة اليوم ويرجع لجدوله). date = YYYY-MM-DD.
- cancel_plan: يلغي كل الخطط المحفوظة لطبيب في date.
- schedule: دوام ثابت (start_time و end_time). mode = all_days (كل أيامه صارت هالوقت) / only_days (الأيام days بس بدوام مختلف، الباقي زي ما هو) / set_days (أيام دوامه صارت days بهالوقت). start_date لو يبدأ يوم جاي.
- info: room / ext / fee.
- vacation: start_date و end_date (آخر يوم إجازة).
- end_vacation: return_date = يوم المباشرة.
- add_doctor: name, dept (لازم قسم من أقسام الجدول — لو ما تعرفه اسأل قبل ما تضيف)، days, start_time, end_time, room, ext, fee.
- move_doctor: doctor_id + dept — ينقل الطبيب لقسم ثاني.
- remove_doctor: doctor_id (و start_date لو من يوم جاي).
- alias: doctor_id + alias (اسم ثاني يكتبونه في القروب).
- remove_alias: doctor_id + alias — يشيل اسم ثاني انحفظ غلط (مثل اسم طبيب ثاني انربط فيه).
- لا توعد بشي ما تسويه الأفعال («ما راح أربط…»): لو فيه ربط غلط شيله بـ remove_alias.
- pending_doctor: code + decision (approve/reject)، وتقدر تعدّل dept/days/start_time/end_time/room/fee قبل الإضافة.
- option: code + n (رقم خيار من رسالة الخيارات).
- resolve: code — يقفل سؤال/رسالة قروب منتظرة (ويحط ✅ على رسالتها في القروب بعد ما ينحفظ). حطه مع أفعال التصحيح، أو لحاله لو قال «تجاهلها».
- undo: يرجّع الجدول الثابت للنسخة اللي قبل آخر تعديل.
- reports: on = true/false (تقارير القروب له).
doctor_id لازم من الجدول تحت.`;

const SCHEMA = { type: "OBJECT", properties: {
  reply: { type: "STRING" }, confirm_first: { type: "BOOLEAN" }, use_proposal: { type: "BOOLEAN" },
  actions: { type: "ARRAY", items: { type: "OBJECT", properties: {
    type: { type: "STRING", enum: ["status", "cancel_plan", "schedule", "info", "vacation", "end_vacation", "add_doctor", "move_doctor", "remove_doctor", "alias", "remove_alias", "pending_doctor", "option", "resolve", "undo", "reports"] },
    doctor_id: { type: "STRING" }, kind: { type: "STRING" }, date: { type: "STRING" },
    start_time: { type: "STRING" }, end_time: { type: "STRING" }, until_next_day: { type: "BOOLEAN" }, at_time: { type: "STRING" }, delay_minutes: { type: "INTEGER" },
    mode: { type: "STRING" }, days: { type: "ARRAY", items: { type: "INTEGER" } }, start_date: { type: "STRING" }, end_date: { type: "STRING" }, return_date: { type: "STRING" },
    name: { type: "STRING" }, dept: { type: "STRING" }, room: { type: "STRING" }, ext: { type: "STRING" }, fee: { type: "STRING" }, alias: { type: "STRING" },
    code: { type: "STRING" }, decision: { type: "STRING" }, n: { type: "INTEGER" }, on: { type: "BOOLEAN" } }, required: ["type"] } } },
  required: ["reply"] };

async function callAI(system, contents) {
  for (const model of A.models) {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 60000);
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": A.gemini }, signal: ctl.signal,
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: "application/json", responseSchema: SCHEMA } }) });
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
export async function handle(m, text, { forwarded = false } = {}) {
  if (!A?.gemini) return false;
  const ci = m.message?.extendedTextMessage?.contextInfo || {};
  const q = ci.quotedMessage, quoted = (q?.conversation || q?.extendedTextMessage?.text || q?.imageMessage?.caption || "").trim();
  const t = A.nowR(), tomorrow = A.isoPlus(t.iso, 1);
  const [planD, pdD, pcD] = await Promise.all([A.db.doc("board/bawadi_plan").get(), A.db.doc("bot/pending_doctors").get(), A.db.doc("bot/pending_clarify").get()]);
  const plans = (planD.data()?.items || []).filter(i => i.date >= t.iso).sort((a, b) => a.date.localeCompare(b.date));
  const pdocs = (pdD.data()?.items || []).filter(i => Date.now() - i.at < 7 * 864e5);
  const pclar = (pcD.data()?.items || []).filter(i => Date.now() - i.at < 12 * 3600e3);
  const night = t.m < 300 ? `\nملاحظة: الساعة الحين بعد 12 بالليل — «اليوم» بدأ للتو (${dayName(t.iso)})، واللي قبله ${dayName(A.isoPlus(t.iso, -1))}.` : "";
  const system = RULES + `\n\nالحين: ${dayName(t.iso)} ${t.iso} الساعة ${hh(t.m)} (بكرة ${dayName(tomorrow)} ${tomorrow}).${night}
\n## جدول أطباء البوادي (id | الاسم | أسماء ثانية | القسم | الأيام | الدوام | …)\n${doctorsBlock()}
\n## الإجازات (الحالية والجاية)\n${vacBlock(t.iso)}
\n## حالات اليوم ${t.iso} (على الموقع والأداة الحين)\n${todayBlock(t.iso)}
\n## خطط محفوظة لأيام جاية (تنطبق أول يومها)\n${planBlock(plans)}
\n## طلبات تنتظر أنس\n${pendingBlock(pdocs, pclar)}
\n## آخر رسايل القروب (وش سوى البوت فيها)\n${groupBlock()}
\n## اقتراح ينتظر موافقته\n${proposal ? proposal.summary : "—"}`;
  const user = (forwarded ? "[رسالة محوّلة من قروب الاستقبال]\n" : "") + (quoted ? `[يرد على: «${quoted.slice(0, 600)}»]\n` : "") + text;
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
  let actions = (Array.isArray(out.actions) ? out.actions : []).map(normA).map(a => fillDept(a, out.reply, text));
  // فعل ناقص (حقول ما تعبّت) → نرجع للذكاء مرة وحدة يكمّله بدل ما نقول «ما طبّقت»
  const miss = actions.map(a => [a, check(a)]).filter(([, w]) => w);
  if (miss.length && !out.use_proposal) {
    const fix = await callAI(system, [...contents, { role: "model", parts: [{ text: JSON.stringify({ reply: out.reply, actions: out.actions }) }] },
      { role: "user", parts: [{ text: "[النظام] الأفعال هذي ناقصة وما تنفع:\n" + miss.map(([a, w]) => `- ${a.type}: ${w}`).join("\n") + "\nرجّع نفس الرد مع actions كاملة: كل فعل فيه حقوله المطلوبة بالضبط (status: doctor_id, kind, date, start_time/end_time أو at_time حسب النوع — move_doctor: doctor_id و dept باسم قسم من الجدول — add_doctor: name و dept …). لو فعلاً ناقصك معلومة من أنس، اسأله و actions فاضية." }] }]).catch(() => null);
    if (fix) { const fa = (Array.isArray(fix.actions) ? fix.actions : []).map(normA).map(a => fillDept(a, fix.reply, text)); if (!fa.length || !fa.some(a => check(a))) { blog(user, out); out = fix; actions = fa; } }
  }
  blog(user, out);
  if (out.use_proposal && proposal?.actions?.length && !actions.length) actions = proposal.actions;
  let reply = String(out.reply || "").split("\n").filter(l => !/✅|انحفظ|حفظته|تم الحفظ/.test(l)).join("\n").trim();
  if (actions.length) for (const [a, b] of TENSE) reply = reply.replace(a, b);   // التنفيذ بعد الرد — ما نقول «عدّلت» قبل ما ينحفظ
  if (out.confirm_first && actions.length && !out.use_proposal) {
    const bad = actions.map(a => check(a)).filter(Boolean);
    if (bad.length) { await A.dmAdmin(`${reply}\n\n⚠️ ${bad.join("\n⚠️ ")}`); return true; }
    proposal = { at: Date.now(), actions, summary: actions.map(describe).join("\n") }; persist();
    await A.dmAdmin(`${reply}\n\nاللي بسويه لو وافقت:\n${proposal.summary}`);
    return true;
  }
  if (!actions.length) { await A.dmAdmin(reply || "تمام."); return true; }
  proposal = null; persist();
  const lines = await execute(actions, pclar, pdocs);
  await A.dmAdmin([reply, lines.join("\n")].filter(Boolean).join("\n\n"));
  return true;
}

const TENSE = [[/(^|\s)(عدّلت|عدلت)(?=\s|$)/g, "$1بعدّل"], [/(^|\s)(أضفت|اضفت|ضفت)(?=\s|$)/g, "$1بضيف"], [/(^|\s)(حطيت)(?=\s|$)/g, "$1بحط"], [/(^|\s)(شلت)(?=\s|$)/g, "$1بشيل"],
  [/(^|\s)(سجّلت|سجلت)(?=\s|$)/g, "$1بسجّل"], [/(^|\s)(غيّرت|غيرت)(?=\s|$)/g, "$1بغيّر"], [/(^|\s)(طبّقت|طبقت)(?=\s|$)/g, "$1بطبّق"], [/(^|\s)(خليت|خلّيت)(?=\s|$)/g, "$1بخلّي"],
  [/(^|\s)(ألغيت|الغيت)(?=\s|$)/g, "$1بلغي"], [/(^|\s)(رجّعت|رجعت)(?=\s|$)/g, "$1برجّع"], [/(^|\s)(نقلت)(?=\s|$)/g, "$1بنقل"], [/(^|\s)(وأضفت|واضفت)(?=\s|$)/g, "$1وبضيف"], [/(^|\s)(وعدّلت|وعدلت)(?=\s|$)/g, "$1وبعدّل"]];
// آخر 10 ردود للذكاء (للمراجعة لو صار شي غلط) — بدون بيانات مراجعين
const bl = [];
function blog(user, out) {
  bl.push({ at: Date.now(), model: out.__model || "", user: String(user).slice(0, 400), reply: String(out.reply || "").slice(0, 400), actions: JSON.stringify(out.actions || []).slice(0, 1500), cf: !!out.confirm_first, up: !!out.use_proposal });
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
// أسماء الحقول من الذكاء → الأسماء الداخلية (يقبل الاسم القديم احتياط)
function normA(a) {
  const o = {}; for (const [k, v] of Object.entries(a || {})) if (v !== "" && v != null && !(Array.isArray(v) && !v.length)) o[k] = v;   // الحقول الفاضية اللي يعبّيها الذكاء بلا معنى
  if (!o.date && o.start_date && ["status", "cancel_plan"].includes(o.type)) o.date = o.start_date;
  o.from = a.start_time ?? a.from ?? (a.kind === "starts_at" ? a.at_time : undefined);
  o.until = a.end_time ?? a.until;
  o.at = a.at_time ?? a.at;
  return o;
}
// القسم ناقص في نقل/إضافة → من رد الذكاء («لقسم الأطفال») أو من كلام أنس
function fillDept(a, reply, user) {
  if (!["move_doctor", "add_doctor"].includes(a.type) || A.findDep(a.dept)) return a;
  const m = /قسم\s+([^\s.،,]+(?:\s+(?:و|والأذن|البولية|الطبيعي|العام|والولادة|والحنجرة)[^\s.،,]*)*)/.exec(reply || "");
  const dep = (m && A.findDep(m[1])) || A.findDep(String(user || "").split("\n").pop());
  return dep && !/أخرى/.test(dep.name) ? { ...a, dept: dep.name } : a;
}
const ISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const docOf = id => A.docs().find(x => x.id === id);
function check(a) {
  const d = a.doctor_id ? docOf(a.doctor_id) : null, t = A.nowR();
  if (["status", "cancel_plan", "schedule", "info", "vacation", "end_vacation", "remove_doctor", "alias", "remove_alias", "move_doctor"].includes(a.type) && !d) return `ما لقيت الطبيب (${a.doctor_id || "—"}) في الجدول`;
  if (a.type === "status") {
    const date = ISO(a.date) ? a.date : t.iso;
    if (date < t.iso && !(date === A.isoPlus(t.iso, -1) && a.until_next_day)) return `التاريخ ${a.date} فات`;
    if (date > A.isoPlus(t.iso, 14)) return "التاريخ بعيد (أكثر من أسبوعين)";
    if (a.kind === "starts_at" && toMin(a.from) == null) return `د. ${A.shortName(d.name)}: ناقص وقت البداية`;
    if (!["starts_at", "present", "leaves_at", "late", "stop", "free", "appointments_only", "busy", "absent_today", "clear"].includes(a.kind)) return `نوع حالة غريب (${a.kind})`;
  }
  if (a.type === "schedule" && (toMin(a.from) == null || toMin(a.until) == null) && a.mode !== "set_days") return `د. ${A.shortName(d.name)}: ناقص وقت الدوام`;
  if (a.type === "vacation" && (!ISO(a.start_date) || !ISO(a.end_date))) return "ناقص تاريخ بداية/نهاية الإجازة";
  if (a.type === "end_vacation" && !ISO(a.return_date)) return "ناقص يوم المباشرة";
  if (a.type === "add_doctor" && !String(a.name || "").trim()) return "ناقص اسم الطبيب";
  if (a.type === "add_doctor" && !A.findDep(a.dept)) return `ناقص القسم${a.dept ? " («" + a.dept + "» مو من أقسام الجدول)" : ""} — وش قسمه؟`;
  if (a.type === "move_doctor" && !A.findDep(a.dept)) return `القسم «${a.dept || "—"}» مو موجود في الجدول`;
  return "";
}
function describe(a) {
  const d = a.doctor_id ? docOf(a.doctor_id) : null, n = d ? "د. " + A.shortName(d.name) : a.name ? "د. " + a.name : a.doctor_id ? `(${a.doctor_id})` : "";
  const t = A.nowR(), date = ISO(a.date) ? a.date : t.iso, when = date === t.iso ? "اليوم" : date === A.isoPlus(t.iso, 1) ? `بكرة ${dayName(date)}` : `${dayName(date)} ${dmy(date)}`;
  const f = toMin(a.from), u = toMin(a.until), at = toMin(a.at), next = a.until_next_day || (f != null && u != null && u <= f);
  const H = m => A.hm(m), uTxt = u != null ? H(u) + (next ? ` (صباح ${dayName(A.isoPlus(date, 1))})` : "") : "";
  switch (a.type) {
    case "status": return `• ${n} — ${when}: ` + ({ starts_at: `دوام من ${f != null ? H(f) : "؟"}${u != null ? " لين " + uTxt : ""}`, present: `موجود${u != null ? " لين " + uTxt : ""}`, leaves_at: `يطلع ${uTxt || (at != null ? H(at) : "")}`, late: `متأخر${at != null ? " يوصل " + H(at) : a.delay_minutes ? " " + a.delay_minutes + " دقيقة" : ""}`, stop: `وقف استقبال${at != null ? " الساعة " + H(at) : ""}`, free: "فاضي — دخّلوا له", appointments_only: `مواعيد فقط${at != null ? " من " + H(at) : ""}`, busy: "زحمة", absent_today: "غير متواجد", clear: "شلت حالته — يرجع لجدوله" }[a.kind] || a.kind);
    case "cancel_plan": return `• ${n} — ألغيت المحفوظ ليوم ${dayName(a.date || date)} ${dmy(a.date || date)}`;
    case "schedule": return `• ${n} — دوام ثابت: ${a.mode === "only_days" ? "كل " + (a.days || []).map(i => WD[i]).join(" و") + " " : a.mode === "set_days" ? "أيامه " + (a.days || []).map(i => WD[i]).join("، ") + " " : "كل أيامه "}${f != null && u != null ? H(f) + " – " + H(u) : ""}${ISO(a.start_date) ? " (من " + dmy(a.start_date) + ")" : ""}`;
    case "info": return `• ${n} — ${[a.fee ? "كشفية " + a.fee : "", a.room ? "غرفة " + a.room : "", a.ext ? "تحويلة " + a.ext : ""].filter(Boolean).join(" · ")}`;
    case "vacation": return `• ${n} — إجازة ${dmy(a.start_date)} → ${dmy(a.end_date)}`;
    case "end_vacation": return `• ${n} — يباشر ${dayName(a.return_date)} ${dmy(a.return_date)}`;
    case "add_doctor": return `• إضافة د. ${a.name} — ${a.dept || "—"}${f != null && u != null ? " · " + H(f) + " – " + H(u) : ""}${a.days?.length ? " · " + a.days.map(i => WD[i]).join("،") : ""}`;
    case "move_doctor": return `• نقل ${n} لقسم ${a.dept}`;
    case "remove_doctor": return `• شيل ${n} من الجدول${ISO(a.start_date) ? " يوم " + dmy(a.start_date) : ""}`;
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
    let r;
    try { r = await run(a, t, pclar, pdocs); } catch (e) { r = { ok: false, why: String(e?.message || e).slice(0, 140) }; }
    if (r?.skip) continue;
    out.push(r?.ok ? `✅ انحفظ وتأكدت منه في الموقع: ${describe(a).replace(/^• /, "")}${r.note ? " — " + r.note : ""}` : `❌ ما انحفظ: ${describe(a).replace(/^• /, "")}${r?.why ? " — " + r.why : ""}`);
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
    const f = toMin(a.from), u = toMin(a.until), shifts = f != null && u != null ? [{ s: f, e: u }] : null;
    const days = (a.days || []).filter(x => x >= 0 && x <= 6 && x !== 5);
    const sch = a.mode === "only_days" ? { days, shifts, altOnly: true } : a.mode === "set_days" ? { days, shifts } : { days: [], shifts };
    if (ISO(a.start_date) && a.start_date > t.iso) {
      await A.db.doc("board/bawadi_plan").set({ items: A.FieldValue.arrayUnion({ id: A.uid(), date: a.start_date, doctorId: id, kind: "set_schedule", sch, by: BY }), at: Date.now() }, { merge: true });
      await sleep(800); return { ok: (await readPlan()).some(i => i.doctorId === id && i.date === a.start_date && i.kind === "set_schedule"), note: "ينطبق يومها" };
    }
    await A.updateSchedules([{ d, sch }], { by: BY });
    await sleep(1000); const { x } = await readBoardDoc(); if (!x) return { ok: false, why: "ما لقيته" };
    const J = v => JSON.stringify((v || []).map(y => [y.s, y.e]));
    if (sch.altOnly) return { ok: !!x.alt && days.every(i => x.alt.days.includes(i)) && J(x.alt.shifts) === J(shifts) || (J(x.shifts) === J(shifts) && !(x.alt?.days || []).some(i => days.includes(i))) };
    return { ok: (!shifts || J(x.shifts) === J(shifts)) && (!days.length || JSON.stringify([...x.workdays].sort()) === JSON.stringify([...days].sort())) };
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
  if (mark.length) await ref.set({ ids: [...doneIds, ...mark], at: Date.now() }, { merge: true });
  if (lines.length) await A.dmAdmin(`🔧 تصحيحات بعد التحديث:\n\n${lines.join("\n\n")}`);
}
