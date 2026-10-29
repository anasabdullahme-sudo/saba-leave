/* ==========================================================================
   سابا ← صحة : لوحة عائمة داخل منصة صحة تعبّي نموذج الإجازة من طلب سابا
   - ما يضغط "تحقق" ولا "حفظ" أبداً (كل طلب يخصم نقاط) — الموظف يضغطها بنفسه
   - يعبّي الخانات الفاضية بس، وما يكتب فوق شي عدّله الموظف
   ========================================================================== */
(() => {
  if (window.__sabaSeha) return; window.__sabaSeha = true;
  // صحة ممكن تفتح نموذج الإجازة داخل إطار (iframe): اللوحة في الصفحة الرئيسية، والتعبئة تشتغل في كل إطار
  const TOP = window === window.top;
  // بعد التحديث التلقائي النسخة القديمة من السكربت «تنقطع» — نوقفها عشان ما تشتغل نسختين
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const FID = Math.random().toString(36).slice(2, 8);

  // ---------- إعدادات يمكن تعديلها ----------
  // شكل التاريخ في صحة: الخطوة 1 (الهوية والميلاد) بـ "/" ، وبيانات الإجازة (الخطوة 2) بـ "-"
  const DATE_FMT = "YYYY-MM-DD";           // الخطوة 2: 2026-10-14 و 1448-05-03
  const DATE_FMT_STEP1 = "DD/MM/YYYY";     // الخطوة 1: 28/05/1999
  const HIJRI_FILL = false;                // خانات الهجري ما نعبيها (صحة تحسبها من الميلادي)
  const TYPE_LABEL = {                      // نوع الإجازة في صحة لكل نوع طلب في سابا
    sick: "إجازة مرضية اعتيادية",
    companion: "إجازة مرضية اعتيادية/إجازة مرافق",   // (مو «إجازة مرافق» لحالها)
    attendance: "مشهد مراجعة",
  };
  const ID_TYPE = { "1": "مواطن", "2": "مقيم" };

  // ---------- أدوات ----------
  const norm = s => String(s || "")
    .replace(/[ً-ْـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/[ىیئ]/g, "ي").replace(/ک/g, "ك").replace(/ؤ/g, "و").replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[*:：]/g, " ").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
  const fmtDate = (dmy, f = DATE_FMT) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy || ""); if (!m) return dmy || "";
    return f.replace("DD", m[1]).replace("MM", m[2]).replace("YYYY", m[3]);
  };
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  // بحث يدخل داخل Shadow DOM (بعض صفحات صحة مبنية بمكوّنات معزولة)
  const shadowOf = el => el.shadowRoot || (chrome.dom?.openOrClosedShadowRoot ? (() => { try { return chrome.dom.openOrClosedShadowRoot(el); } catch { return null; } })() : null);
  let shadowHosts = [];
  function deepAll(sel) {
    const out = [], hosts = [];
    const walk = r => {
      out.push(...r.querySelectorAll(sel));
      for (const el of r.querySelectorAll("*")) { if (el.id === "saba-seha-host") continue; const sr = shadowOf(el); if (sr) { hosts.push(el); walk(sr); } }
    };
    walk(document); shadowHosts = hosts;
    return out.filter(el => !el.closest("#saba-seha-host"));
  }
  // النص الظاهر فقط (بدون سكربتات أو عناصر مخفية)
  const deepText = () => deepAll("*").filter(el => !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/i.test(el.tagName) && ownText(el) && visible(el)).map(ownText).join(" ");
  const ownText = el => { let t = ""; for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent; return t.trim(); };
  const CONTROL = "input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=button]):not([type=submit]), select, textarea";

  // ---------- التاريخ الهجري (أم القرى — نفس تقويم صحة) ----------
  const HIJRI = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" });
  function toHijriDmy(dmy) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy || ""); if (!m) return "";
    const p = HIJRI.formatToParts(new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12)));
    const g = t => (p.find(x => x.type === t) || {}).value || "";
    return `${g("day").padStart(2, "0")}/${g("month").padStart(2, "0")}/${g("year")}`;
  }

  // ---------- خريطة الخانات (عنوان الخانة في صحة ← قيمة من الطلب) ----------
  // كل regex على النص بعد التطبيع: بدون همزات، ة→ه، والشرطة المائلة بدون مسافات
  const G = (k, f) => r => fmtDate(r[k], f);                    // ميلادي
  const H = (k, f) => r => fmtDate(toHijriDmy(r[k]), f);        // هجري
  const startOf = r => r.type === "attendance" ? (r.visitDate || r.leaveStart) : r.leaveStart;
  // تاريخ الدخول/الخروج: لو رفع الطلب بنفس يوم الإجازة أو بعدها → يوم الإجازة نفسه، ولو رفعه قبلها → يوم الرفع
  const dkey = d => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || ""); return m ? +(m[3] + m[2] + m[1]) : 0; };
  // ولو رفعه قبلها بأكثر من يوم → يوم واحد قبل الإجازة (أقصى شي)
  const dayBefore = d => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || ""); if (!m) return d; const x = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1] - 1)); return `${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${x.getUTCFullYear()}`; };
  const entryOf = r => { const st = startOf(r), sub = r.submitDate; if (!sub || !dkey(sub)) return st; if (!dkey(st)) return sub; if (dkey(sub) >= dkey(st)) return st; const pre = dayBefore(st); return dkey(sub) >= dkey(pre) ? sub : pre; };
  const notAtt = r => r.type === "attendance", onlyAtt = r => r.type !== "attendance", onlyComp = r => r.type !== "companion";
  const RULES = [
    // الخطوة 1
    { key: "companionId", re: /هويه المرافق|اقامه المرافق/, skipIf: onlyComp },
    { key: "idNumber",    re: /رقم (ال)?هويه|رقم (ال)?اقامه|الهويه\/الاقامه/, not: /^(?!.*المريض).*المرافق/ },
    { key: "dob",         re: /الميلاد\/?\s*ميلادي/, not: /المرافق/, val: G("dob", DATE_FMT_STEP1) },
    { key: "dob",         re: /الميلاد\/?\s*هجري/, not: /المرافق/, val: H("dob", DATE_FMT_STEP1), hijri: true },
    // الخطوة 2 — معلومات مقدم الطلب
    { key: "fileNo",      re: /رقم السجل الطبي|رقم الملف الطبي/ },
    { key: "phone",       re: /(رقم )?(الجوال|الهاتف|المحمول)/, val: (r, el) => {
        const p = String(r.phone || "").replace(/\D/g, "").replace(/^966/, "").replace(/^0/, "");
        const has966 = /966/.test(el.parentElement?.textContent || "") || /966/.test(el.closest("div")?.parentElement?.textContent || "");
        return has966 || el.maxLength === 9 ? p : "0" + p; } },
    // تاريخ الدخول = يوم إرسال المراجع للطلب (احتياط: بداية الإجازة لو الطلب قديم)
    { key: "entryDate",   re: /تاريخ الدخول ميلادي/, val: r => fmtDate(entryOf(r)) },
    { key: "entryDate",   re: /تاريخ الدخول هجري/, val: r => fmtDate(toHijriDmy(entryOf(r))), hijri: true },
    // تاريخ الخروج = نفس تاريخ الدخول دايماً
    { key: "exitDate",    re: /تاريخ الخروج ميلادي/, val: r => fmtDate(entryOf(r)) },
    { key: "exitDate",    re: /تاريخ الخروج هجري/, val: r => fmtDate(toHijriDmy(entryOf(r))), hijri: true },
    { key: "visitDate",   re: /^تاريخ المراجعه ميلادي|تاريخ (الزياره|الحضور)/, val: G("visitDate"), skipIf: onlyAtt },
    { key: "visitDate",   re: /^تاريخ المراجعه هجري/, val: H("visitDate"), hijri: true, skipIf: onlyAtt },
    // الخطوة 2 — التوصيات
    { key: "leaveDays",   re: /منحه اجازه( مرضيه)? لمده|(مده|عدد ايام) الاجازه|عدد الايام/, skipIf: notAtt },
    { key: "leaveStart",  re: /^من تاريخ ميلادي|(تاريخ )?(بدايه|بدء) الاجازه/, val: G("leaveStart"), skipIf: notAtt },
    { key: "leaveStart",  re: /^من تاريخ هجري/, val: H("leaveStart"), hijri: true, skipIf: notAtt },
    { key: "leaveEnd",    re: /(تاريخ )?(نهايه|انتهاء) الاجازه/, val: G("leaveEnd"), skipIf: notAtt },
    // المرافق
    { key: "companionName", re: /اسم المرافق/, skipIf: onlyComp },
    { key: "companionDob",  re: /ميلاد المرافق.*ميلادي|ميلاد المرافق$/, val: G("companionDob", DATE_FMT_STEP1), skipIf: onlyComp },
    { key: "companionDob",  re: /ميلاد المرافق.*هجري/, val: H("companionDob", DATE_FMT_STEP1), hijri: true, skipIf: onlyComp },
    { key: "relationship",  re: /صله القرابه|القرابه/, skipIf: onlyComp },
    // نموذج «إجازة مرافق» في صحة: نفس العناوين تتكرر — الأولى للمريض، والثانية (تحت «طبيعة المرافق») للمرافق
    { key: "companionId",   re: /رقم (ال)?هويه|رقم (ال)?اقامه|الهويه\/الاقامه/, not: /المريض/, nth: 1, skipIf: onlyComp },
    { key: "companionDob",  re: /الميلاد\/?\s*ميلادي/, not: /المريض/, nth: 1, val: G("companionDob", DATE_FMT_STEP1), skipIf: onlyComp },
    { key: "companionDob",  re: /الميلاد\/?\s*هجري/, not: /المريض/, nth: 1, val: H("companionDob", DATE_FMT_STEP1), hijri: true, skipIf: onlyComp },
    { key: "relationship",  re: /طبيعه المرافق/, selectOnly: true, skipIf: onlyComp },
    // الصفحة الثانية في «مرضية اعتيادية/مرافق»: قسم المرافقة بعد التوصيات (نفس العناوين مرة ثانية)
    { key: "leaveDays",     re: /مرافقه لمده/, skipIf: onlyComp },
    { key: "leaveStart",    re: /^من تاريخ ميلادي/, nth: 1, val: G("leaveStart"), skipIf: onlyComp },
    { key: "leaveStart",    re: /^من تاريخ هجري/, nth: 1, val: H("leaveStart"), hijri: true, skipIf: onlyComp },
    { key: "phone",         re: /^رقم الجوال/, nth: 1, skipIf: onlyComp, val: (r, el) => {
        const p = String(r.phone || "").replace(/\D/g, "").replace(/^966/, "").replace(/^0/, "");
        const has966 = /966/.test(el.parentElement?.textContent || "") || /966/.test(el.closest("div")?.parentElement?.textContent || "");
        return has966 || el.maxLength === 9 ? p : "0" + p; } },
  ];
  const FIELD_LABELS = {
    idNumber: "رقم الهوية", fileNo: "رقم الملف", dob: "تاريخ الميلاد", patientName: "اسم المريض", patientNameEn: "الاسم بالإنجليزي", phone: "الجوال",
    leaveStart: "بداية الإجازة", entryDate: "تاريخ الدخول", exitDate: "تاريخ الخروج", leaveEnd: "نهاية الإجازة", leaveDays: "عدد الأيام", visitDate: "تاريخ الحضور",
    companionName: "اسم المرافق", companionId: "هوية المرافق", companionDob: "ميلاد المرافق", relationship: "صلة القرابة",
    doctorName: "الطبيب", doctorAr: "الطبيب المرخّص", stampDoctor: "ختم الطبيب", reason: "السبب", nationality: "الجنسية", gender: "الجنس", ref: "رقم طلب سابا",
  };

  // ---------- إيجاد الخانة من عنوانها ----------
  // أي عنصر فيه نص مباشر (مو بس label) — صحة تحط النجمة والأيقونات داخل العنوان
  const SKIP_TAG = /^(SCRIPT|STYLE|NOSCRIPT|OPTION|SELECT|TEXTAREA|BUTTON|svg|path)$/i;
  function labelCandidates() {
    const out = [];
    for (const el of deepAll("*")) {
      if (SKIP_TAG.test(el.tagName) || el.closest("#saba-seha-host")) continue;
      const own = ownText(el); if (!own) continue;
      if (!visible(el)) continue;
      let t = norm(el.textContent); if (t.length > 60) t = norm(own);
      if (t && t.length <= 60) out.push({ el, t });
    }
    return out;
  }
  // الخانة اللي تحت العنوان مباشرة على الشاشة (أدق طريقة لتصميم صحة: العنوان فوق والخانة تحته)
  function controlBelow(labelEl) {
    const L = labelEl.getBoundingClientRect(); if (!L.width) return null;
    let best = null, bestD = 1e9;
    for (const c of deepAll(CONTROL)) {
      if (c.closest("#saba-seha-host") || !visible(c)) continue;
      const R = c.getBoundingClientRect();
      const dy = R.top - L.bottom;
      if (dy < -6 || dy > 70) continue;
      const overlap = Math.min(L.right, R.right) - Math.max(L.left, R.left);
      if (overlap < Math.min(L.width, R.width) * 0.3) continue;
      const d = dy + Math.abs(R.right - L.right) * 0.05;   // RTL: العنوان على يمين الخانة
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }
  function controlFor(labelEl) {
    if (labelEl.htmlFor) { const c = document.getElementById(labelEl.htmlFor); if (c && c.matches(CONTROL)) return c; }
    const geo = controlBelow(labelEl); if (geo) return geo;
    let node = labelEl;
    for (let i = 0; i < 4 && node; i++) {
      node = node.parentElement; if (!node) break;
      const list = [...node.querySelectorAll(CONTROL)].filter(c => visible(c) && !c.disabled);
      if (!list.length) continue;
      // أول خانة بعد العنوان في ترتيب الصفحة
      const after = list.find(c => labelEl.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
      return after || list[0];
    }
    return null;
  }
  function setValue(el, v) {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, v);
    ["input", "change", "keyup", "blur"].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
  }
  function pickOption(select, text) {
    const want = norm(text);
    const opt = [...select.options].find(o => norm(o.textContent) === want) || [...select.options].find(o => norm(o.textContent).includes(want));
    if (!opt) return false;
    setValue(select, opt.value); return true;
  }
  function clickRadioByText(text) {
    const want = norm(text);
    const RADIO = "input[type=radio], [role=radio], mat-radio-button, .mat-radio-button, .mat-mdc-radio-button, p-radiobutton";
    const cands = deepAll("*")
      .filter(el => ownText(el) && visible(el) && !el.closest("#saba-seha-host"))
      .filter(el => { const t = norm(el.textContent); return t === want || (t.includes(want) && t.length <= want.length + 4); });
    for (const el of cands) {
      let r = el.querySelector("input[type=radio]") || (el.htmlFor && document.getElementById(el.htmlFor))
        || (el.previousElementSibling?.matches?.(RADIO) && el.previousElementSibling)
        || (el.nextElementSibling?.matches?.(RADIO) && el.nextElementSibling)
        || el.closest(RADIO);
      for (let n = el.parentElement, i = 0; !r && n && i < 3; n = n.parentElement, i++) {
        const rs = n.querySelectorAll(RADIO); if (rs.length === 1) r = rs[0]; else if (rs.length > 1) break;
      }
      if (!r) continue;
      const inp = r.matches("input") ? r : r.querySelector("input[type=radio]");
      if (inp?.checked || r.getAttribute("aria-checked") === "true" || /checked/.test(String(r.className))) return true;
      (inp || r).click();
      if (inp && !inp.checked) el.click();
      return true;
    }
    return false;
  }
  // احتياط: خانة عليها placeholder / aria-label يطابق
  function controlByHint(re, not) {
    return deepAll(CONTROL).find(c => {
      if (c.closest("#saba-seha-host") || !visible(c)) return false;
      const h = norm([c.placeholder, c.getAttribute("aria-label"), c.title].filter(Boolean).join(" "));
      return h && re.test(h) && !(not && not.test(h));
    }) || null;
  }

  // ---------- التعبئة ----------
  const filledEls = new WeakSet();
  let lastReport = {};
  function fillPass(req, labs, report, hijriPass, explicit) {
    for (const rule of RULES) {
      if (!!rule.hijri !== hijriPass || rule.skipIf?.(req)) continue;
      let c = null;
      if (rule.nth) {                                    // الخانة رقم n من الخانات اللي لها نفس العنوان (بترتيب الصفحة)
        const ctrls = [];
        for (const x of labs) if (rule.re.test(x.t) && !(rule.not && rule.not.test(x.t))) { const cc = controlFor(x.el); if (cc && !ctrls.includes(cc)) ctrls.push(cc); }
        c = ctrls[rule.nth] || null;
      } else {
        const lab = labs.find(x => rule.re.test(x.t) && !(rule.not && rule.not.test(x.t)));
        c = (lab && controlFor(lab.el)) || controlByHint(rule.re, rule.not);
      }
      if (!c || c.disabled) continue;
      if (rule.selectOnly && !(c instanceof HTMLSelectElement)) continue;   // «طبيعة المرافق» قائمة اختيار بس — ما نكتب في خانة نص بالغلط
      const val = rule.val ? rule.val(req, c) : String(req[rule.key] || "");
      if (!val) continue;
      if (c.value) { if (!hijriPass) report[rule.key] = report[rule.key] || "ok"; continue; } // ما نكتب فوق شي موجود
      if (filledEls.has(c) && !explicit) continue;
      if (c instanceof HTMLSelectElement) { if (!pickOption(c, val)) continue; }
      else setValue(c, val);
      filledEls.add(c); flash(c);
      if (!hijriPass) report[rule.key] = norm(c.value) === norm(val) ? "ok" : "check";
    }
  }
  // ---------- مراقبة تحديثات صحة: خانة إلزامية جديدة ما نعرفها → تنبيه ----------
  // أول 3 أيام نتعلّم الخانات الموجودة بهدوء، وبعدها أي خانة إلزامية جديدة تطلع تنبيه (مرة وحدة لكل خانة)
  const HANDLED = [/نوع الاجازه/, /نوع الهويه/, /الطبيب|الممارس/, /الجنس|الجنسيه|التشخيص|الملاحظات|سبب/];
  let healthAt = 0;
  async function healthCheck() {
    if (Date.now() - healthAt < 15000) return; healthAt = Date.now();
    if (!isFormPage(norm(deepText()))) return;
    const reqLabs = labelCandidates().filter(x => /\*/.test(x.el.textContent || "") && x.t.length > 2 && x.t.length < 45).map(x => x.t);
    const labs = [...new Set(reqLabs)];
    if (!labs.length) return;
    const { sabaKnown: k } = await chrome.storage.local.get("sabaKnown");
    const known = k || { since: Date.now(), list: [] };
    const fresh = labs.filter(t => !known.list.includes(t));
    if (!fresh.length && k) return;
    const learning = Date.now() - known.since < 3 * 86400000;
    const unknown = fresh.filter(t => !RULES.some(r => r.re.test(t)) && !HANDLED.some(re => re.test(t)));
    known.list = [...new Set([...known.list, ...fresh])].slice(-300);
    await chrome.storage.local.set({ sabaKnown: known });
    if (!learning && unknown.length) chrome.storage.local.set({ sabaAlert: { at: Date.now(), labels: unknown.slice(0, 5), url: location.href.slice(0, 120) } });
  }
  // صفحة البحث (فيها زر «إضافة إجازة مرضية») مو النموذج — ما نعبّي فيها شي
  const isSearchPage = t => /بحث عن اجازه مرضيه|نتائج البحث/.test(t);
  const isFormPage = t => !isSearchPage(t) && (/نوع الاجازه/.test(t) || /معلومات مقدم طلب|التوصيات/.test(t));
  function fill(req, { explicit = false } = {}) {
    if (!req || !isFormPage(norm(deepText()))) return {};
    const report = {};
    // 1) نوع الإجازة
    const typeText = TYPE_LABEL[req.type];
    if (typeText && norm(deepText()).includes("نوع الاجازه")) {
      if (clickRadioByText(typeText)) report.type = "ok";
    }
    // 2) نوع الهوية
    const idt = ID_TYPE[String(req.idNumber || "")[0]];
    if (idt) {
      const lab = labelCandidates().find(x => /^نوع الهويه/.test(x.t));
      if (lab) {
        const c = controlFor(lab.el);
        if (c instanceof HTMLSelectElement) { if (c.value || pickOption(c, idt)) report.idType = "ok"; }
        else if (clickRadioByText(idt)) report.idType = "ok";
      }
    }
    // 3) الميلادي والنصوص بس — الهجري ما نكتبه أبداً (التحويل ممكن يختلف يوم عن صحة، وصحة تحسبه لحالها من الميلادي)
    if (HIJRI_FILL) setTimeout(() => fillPass(req, labelCandidates(), {}, true, explicit), 700);
    fillPass(req, labelCandidates(), report, false, explicit);
    // 4) الطبيب المعالج
    const d = pickDoctor(req, explicit);
    if (d) report.doctorAr = d;
    lastReport = { ...lastReport, ...report };
    return report;
  }

  // ---------- الطبيب المعالج ----------
  const docTokens = s => norm(s).toLowerCase().replace(/\b(dr|doctor)\b\.?|(^|\s)(د|دكتور|دكتوره)(\.|\s|$)/g, " ").replace(/(^|\s)(ال|al|el)[- ]?/g, " ").split(/[\s\-\/.]+/).filter(t => t.length > 1);
  const doneDocEls = new WeakSet();
  function pickDoctor(req, explicit) {
    const names = [req.doctorAr, req.doctorEn, req.stampDoctor, req.doctorName].filter(Boolean);
    if (!names.length) return "";
    const lab = labelCandidates().find(x => /^اسم الطبيب المعالج/.test(x.t));
    if (!lab) return "";
    let box = lab.el;
    for (let i = 0; i < 4 && box; i++) { box = box.parentElement; if (box?.querySelector("select, [role=combobox], .ng-select, .select2, input")) break; }
    if (!box) return "";
    const sel = box.querySelector("select");
    if (sel && !sel.disabled) {
      if (sel.value && sel.selectedIndex > 0) return "ok";
      const want = names.map(docTokens);
      let best = null, bestScore = 0, tie = false;
      for (const o of sel.options) {
        const ot = docTokens(o.textContent); if (!ot.length) continue;
        const sc = Math.max(...want.map(w => w.filter(t => ot.includes(t)).length));
        if (sc > bestScore) { best = o; bestScore = sc; tie = false; } else if (sc === bestScore && sc > 0) tie = true;
      }
      if (best && bestScore >= 2 && !tie) { setValue(sel, best.value); flash(sel); return "ok"; }
      // احتياط: اسم عائلة مميز (مو اسم شائع) موجود في خيار واحد بس → هو الطبيب (مثل «والي/والى»)
      const COMMON = new Set(["محمد", "احمد", "عبدالله", "عبد", "علي", "حسن", "حسين", "محمود", "ابراهيم", "عبدالرحمن", "خالد", "mohamed", "mohammed", "muhammad", "ahmed", "ahmad", "ali", "abdullah"]);
      const rare = [...new Set(want.flat())].filter(t => t.length >= 3 && !COMMON.has(t));
      const opts = [...sel.options].filter(o => o.value && docTokens(o.textContent).length);
      for (const t of rare) {
        const hits = opts.filter(o => docTokens(o.textContent).includes(t));
        if (hits.length === 1) { setValue(sel, hits[0].value); flash(sel); return "ok"; }
      }
      return "check";
    }
    // قائمة مخصّصة (بحث): نفتحها ونكتب اسم الطبيب، والموظف يختار
    if (!explicit || doneDocEls.has(box)) return "check";
    doneDocEls.add(box);
    const opener = box.querySelector(".ng-select-container, .select2-selection, [role=combobox], .dropdown-toggle") || box.querySelector("input");
    opener?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); opener?.click();
    setTimeout(() => {
      const inp = box.querySelector("input[type=text], input:not([type])") || document.querySelector(".select2-search__field, .ng-dropdown-panel input");
      const first = docTokens(req.doctorAr || names[0]).slice(0, 2).join(" ");
      if (inp && first) setValue(inp, first);
    }, 250);
    return "check";
  }
  function flash(el) {
    const o = el.style.outline, s = el.style.boxShadow;
    el.style.outline = "2px solid #00A6E2"; el.style.boxShadow = "0 0 0 4px rgba(0,166,226,.18)";
    setTimeout(() => { el.style.outline = o; el.style.boxShadow = s; }, 1600);
  }

  // ---------- الحساب الصحيح في صحة ----------
  function currentAccountText() {
    return [...document.querySelectorAll("body *")]
      .filter(el => el.childElementCount === 0 && !el.closest("#saba-seha-host"))
      .map(el => ({ el, r: el.getBoundingClientRect(), t: el.textContent.trim() }))
      .filter(x => x.r.top >= 0 && x.r.top < 110 && x.t.length < 120 && /مجمع|شركة|عيادات/.test(x.t) && !/منشأة|منشاه/.test(x.t) && !/منشأة/.test(x.el.parentElement?.textContent || ""))
      .map(x => x.t).join(" | ");
  }
  function accountState(req) {
    const acc = req?.account; if (!acc) return { state: "unknown" };
    const onPicker = /حسابات صحة طبي/.test(document.body.innerText);
    if (onPicker) return { state: "picker" };
    const cur = currentAccountText();
    if (!cur) return { state: "unknown" };
    return { state: norm(cur).includes(norm(acc.key)) ? "ok" : "wrong", cur };
  }
  // ---------- تبديل الحساب تلقائياً من قائمة المنشآت (أعلى الصفحة) ----------
  const accLabel = acc => `${acc.key} — ${acc.role}`;
  function accountItems() {
    return deepAll("*").filter(el => visible(el) && /^منشا(ه|ة)/.test(norm(ownText(el))))
      .map(el => { const box = el.closest("a, li, button, [role=menuitem], .dropdown-item") || el.parentElement?.parentElement || el; return { el, box, t: norm(box.textContent) }; });
  }
  function pickAccountItem(acc) {
    const key = norm(acc.key), want = norm(acc.role);
    const items = accountItems().filter(x => x.t.includes(key));
    return items.find(x => x.t.includes(want)) || items.find(x => /اجازات المرضيه/.test(x.t) && /مدخل/.test(x.t)) || items.find(x => /اجازات المرضيه/.test(x.t)) || null;
  }
  let swRef = "", swTries = 0, swNext = 0;
  async function switchAccount(force) {
    const acc = req?.account; if (!TOP || !acc) return;
    if (swRef !== req.ref) { swRef = req.ref; swTries = 0; swNext = 0; }
    if (!force && (swTries >= 1 || Date.now() < swNext)) return;
    swTries++; swNext = Date.now() + 5000;
    // التبديل التلقائي مرة وحدة بس لكل طلب — لو بدّلت أنت بعدها لعيادة ثانية ما نرجّعك
    if (!force) { const { sabaSwFor } = await chrome.storage.local.get("sabaSwFor"); if (sabaSwFor === req.ref) return; }
    await chrome.storage.local.set({ sabaSwFor: req.ref });
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let item = pickAccountItem(acc);
    if (!item) {   // نفتح قائمة الحسابات (اسم المنشأة فوق)
      const head = [...document.querySelectorAll("body *")].filter(el => el.childElementCount === 0 && !el.closest("#saba-seha-host") && visible(el))
        .find(el => { const r = el.getBoundingClientRect(); const t = el.textContent.trim(); return r.top >= 0 && r.top < 110 && /مجمع|شركة|عيادات/.test(t) && !/منشأة/.test(t); });
      if (!head) return;
      realClick(head);
      for (let i = 0; i < 12 && !item; i++) { await wait(250); item = pickAccountItem(acc); }
    }
    if (!item) { toastLocal(`ما لقيت حساب «${accLabel(acc)}» في قائمتك — بدّله يدوياً`); return; }
    if (req?.account !== acc) return;                                            // انقفل الطلب أثناء البحث
    toastLocal(`أبدّل الحساب إلى: ${accLabel(acc)}`);
    try { item.box.scrollIntoView({ block: "nearest" }); } catch {}   // القائمة فيها تمرير
    await wait(150);
    realClick(item.el);
    navUntil = Date.now() + 120000;
  }
  function highlightPicker(req) {
    const acc = req?.account; if (!acc) return;
    document.querySelectorAll("[data-saba-hl]").forEach(el => { el.style.outline = ""; el.removeAttribute("data-saba-hl"); });
    const all = [...document.querySelectorAll("body *")].filter(el => el.childElementCount === 0 && visible(el) && !el.closest("#saba-seha-host"));
    const group = all.find(el => norm(el.textContent) === norm(acc.group));
    const roles = all.filter(el => norm(el.textContent).includes(norm(acc.role)) && norm(el.textContent).includes(norm(acc.key)));
    const mark = (el, color) => { if (!el) return; el.setAttribute("data-saba-hl", "1"); el.style.outline = `3px solid ${color}`; el.style.outlineOffset = "6px"; el.style.borderRadius = "6px"; };
    mark(group, "#00A6E2"); roles.forEach(r => mark(r, "#0E9F6E"));
  }

  // ---------- رقم الإجازة PSL ----------
  const PSL_RE = /PSL\d{8,14}/g;
  const seenPsl = new Set((document.body.innerText.match(PSL_RE) || []));
  let newestPsl = "";
  function scanPsl() {
    const txt = document.body.innerText, found = txt.match(PSL_RE) || [];
    const onSearch = isSearchPage(norm(txt));   // جدول نتائج البحث فيه أرقام قديمة — نتجاهلها
    for (const p of found) if (!seenPsl.has(p)) { seenPsl.add(p); if (!onSearch) newestPsl = p; }
  }

  // ---------- اللوحة العائمة (Shadow DOM حتى ما تتأثر بتصميم صحة) ----------
  if (TOP) document.getElementById("saba-seha-host")?.remove();            // نسخة قديمة من الأداة قبل التحديث التلقائي
  const host = document.createElement("div"); host.id = "saba-seha-host";
  host.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
  <style>
    :host{all:initial}
    *{box-sizing:border-box;font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif}
    .p{direction:rtl;width:310px;max-height:72vh;display:flex;flex-direction:column;background:#fff;color:#0B2B47;border:1px solid #DCEBF4;border-radius:18px;box-shadow:0 18px 50px -12px rgba(0,55,101,.35);overflow:hidden}
    .h{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#003765;color:#fff;cursor:grab;user-select:none;touch-action:none}
    .h.drag{cursor:grabbing}
    .h .grip{opacity:.55;font-size:13px;letter-spacing:-2px}
    .h b{font-size:14px;flex:1}
    .h .dot{width:9px;height:9px;border-radius:50%;background:#7FD0F0}
    .h button{all:unset;cursor:pointer;color:#BFE6F7;font-size:18px;line-height:1;padding:0 4px}
    .b{padding:10px;overflow:auto;display:grid;gap:8px}
    .ft{display:grid;gap:6px;padding:8px 10px 10px;border-top:1px solid #DCEBF4;background:#fff}
    .min .ft{display:none}
    .links{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px}
    .lnk{all:unset;cursor:pointer;color:#0082D4}
    .lnk:hover{text-decoration:underline}
    .fx{background:#F6F1FF;color:#5B3CC4;border:1px solid #E3D8FF}
    .fxbox{border:1px solid #E3D8FF;background:#FBF9FF;border-radius:12px;padding:10px;display:grid;gap:8px}
    .fxbox .chips{display:flex;flex-wrap:wrap;gap:6px}
    .fxbox label{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;border:1px solid #DCEBF4;background:#fff;border-radius:999px;padding:4px 9px;cursor:pointer}
    .fxbox textarea{border-style:solid;border-color:#DCEBF4;min-height:38px}
    details.data summary{font-size:13px;color:#0B2B47;font-weight:600;padding:4px 0}
    .card{padding:8px 10px}
    .card{border:1px solid #DCEBF4;border-radius:12px;padding:10px}
    .card.withimg{display:flex;gap:10px;align-items:flex-start}
    .thumb{all:unset;cursor:pointer;flex:none;width:64px;height:84px;border-radius:8px;overflow:hidden;border:1px solid #DCEBF4;background:#F3F7FA;position:relative;display:grid;place-items:center}
    .thumb img{width:100%;height:100%;object-fit:cover}
    .thumb .pdf{font-weight:700;color:#B4232A;font-size:13px}
    .thumb i{position:absolute;bottom:2px;left:2px;font-style:normal;font-size:12px;background:#fff;border-radius:6px;padding:0 3px}
    .nm{font-weight:700;font-size:15px}
    .meta{font-size:12.5px;color:#5B7690;margin-top:3px;display:flex;flex-wrap:wrap;gap:4px 10px}
    .meta .ltr{direction:ltr}
    .acc{font-size:13px;padding:8px 10px;border-radius:10px;line-height:1.6}
    .acc.ok{background:#E3F6EF;color:#0B6E4F}
    .acc.wrong{background:#FDECEC;color:#B4232A;font-weight:600}
    .acc.picker,.acc.unknown{background:#EAF6FC;color:#0B4A87}
    .row{display:flex;gap:6px}
    .btn{all:unset;cursor:pointer;flex:1;text-align:center;height:40px;line-height:40px;border-radius:11px;font-weight:600;font-size:14px}
    .pri{background:linear-gradient(180deg,#1495E4,#0082D4);color:#fff}
    .sec{background:#F5FBFE;color:#0082D4;border:1px solid #DCEBF4}
    .ok2{background:#0E9F6E;color:#fff}
    #done{box-shadow:0 6px 16px -6px rgba(14,159,110,.55)}
    .btn:focus-visible{outline:3px solid #00A6E2;outline-offset:2px}
    .tg{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#5B7690}
    .fl{display:grid;gap:2px}
    .f{display:grid;grid-template-columns:14px 92px 1fr 30px;align-items:center;gap:6px;padding:5px 0;border-bottom:1px dashed #E3EEF5;font-size:13px}
    .f .k{color:#5B7690}
    .f .v{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .f .v.ltr{direction:ltr;text-align:right}
    .f .s{width:9px;height:9px;border-radius:50%;background:#DCEBF4}
    .f .s.ok{background:#0E9F6E}.f .s.check{background:#D98B12}
    .cp{all:unset;cursor:pointer;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:#5B7690}
    .cp:hover{background:#EAF6FC;color:#0082D4}
    .empty{font-size:13.5px;color:#5B7690;line-height:1.7}
    textarea{width:100%;min-height:44px;border:1.5px dashed #7FD0F0;border-radius:10px;padding:8px;font-size:12.5px;resize:none;direction:rtl}
    input.psl{all:unset;box-sizing:border-box;width:100%;height:38px;border:1.5px solid #DCEBF4;border-radius:10px;padding:0 10px;direction:ltr;text-align:right;font-size:14px;font-family:inherit}
    input.psl:focus{border-color:#00A6E2}
    .lbl{font-size:12.5px;color:#5B7690;margin-bottom:4px}
    .min .b{display:none}
    .p.min{width:auto;border-radius:999px}
    .p.min .h{padding:8px 14px}
    .h .cnt{background:#E5484D;color:#fff;border-radius:999px;font-size:11.5px;font-weight:700;padding:1px 7px;margin-inline-start:4px}
    .qh{font-weight:700;font-size:14px}
    .ql{display:grid;gap:6px;max-height:46vh;overflow:auto}
    .qi{all:unset;cursor:pointer;display:grid;gap:2px;border:1px solid #DCEBF4;border-radius:11px;padding:8px 10px;font-size:13.5px}
    .qi:hover{background:#F5FBFE;border-color:#7FD0F0}
    .qi span{font-size:12px;color:#5B7690}
    .qi.here{border-color:#0E9F6E}
    .qi.lk{opacity:.6;background:#F6F7F9}
    .lkb{font-style:normal;font-size:11.5px;font-weight:600;color:#B45309;background:#FEF3C7;border-radius:6px;padding:1px 6px;margin-inline-start:4px}
    .tiny{font-size:11.5px;color:#8AA0B4}
    details summary{cursor:pointer;font-size:12.5px;color:#0082D4}
    .note{font-size:12px;color:#8A5A12;background:#FFF7EA;border-radius:8px;padding:6px 8px}
  </style>
  <div class="p" id="p">
    <div class="h" id="hd" title="اسحب لتحريك اللوحة — اضغط للتصغير"><span class="grip">⋮⋮</span><span class="dot"></span><b>سابا ← صحة<span class="cnt" id="cnt" hidden></span></b><button id="min" title="تصغير">–</button></div>
    <div class="b" id="body"></div>
    <div class="ft" id="foot" hidden></div>
  </div>`;
  const $ = s => root.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COPY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';

  let reqImg = null;                       // صورة التقرير للطلب المفتوح (تجي من لوحة سابا)
  let req = null, auto = true, minimized = false, queue = [], queueAt = 0, hidden = {}, showFields = false, fixOpen = false, sehaAlert = null, fxType = null, fxChecked = [], fxNoteVal = "";
  const FIX_FIELDS = [
    { k: "patientName", ar: "الاسم" }, { k: "idNumber", ar: "الهوية" }, { k: "dob", ar: "الميلاد" }, { k: "phone", ar: "الجوال" },
    // تواريخ الإجازة ما يعدّلها المريض — الموظف يتأكد منها من صورة التقرير
    { k: "companionName", ar: "اسم المرافق", types: ["companion"] }, { k: "companionId", ar: "هوية المرافق", types: ["companion"] },
    { k: "companionDob", ar: "ميلاد المرافق", types: ["companion"] }, { k: "relationship", ar: "القرابة", types: ["companion"] },
    { k: "photo", ar: "صورة التقرير" },
  ];
  // الطلب «نشط» لما يكون انرسل من لوحة سابا قريب — غير كذا الإضافة ما تتحرك لحالها (عشان لو دخلت صحة بس تتأكد من سكليف)
  const reqAge = () => req ? Date.now() - (req.sentAt || 0) : Infinity;
  const navActive = () => !!req && reqAge() < 5 * 60000;
  const fillActive = () => !!req && reqAge() < 60 * 60000;
  // طلب ضغطت عليه «تم الرفع» أو «طلب تعديل» يختفي من القائمة — لين اللوحة ترجعه (مثلاً المراجع عدّل أو رجّعته للانتظار)
  const isHidden = id => { const t = hidden[id]; return !!t && queueAt < t + 20000; };
  const pendingQ = () => queue.filter(q => !isHidden(q.id) && q.id !== req?.id);
  const hideId = id => { const now = Date.now(); hidden = Object.fromEntries(Object.entries({ ...hidden, [id]: now }).filter(([, t]) => now - t < 3 * 864e5)); return hidden; };
  const queueStale = () => !queueAt || Date.now() - queueAt > 3 * 60000;
  function setMin(v) { minimized = v; $("#p").classList.toggle("min", v); $("#min").textContent = v ? "+" : "–"; }
  function updateCount() { const c = $("#cnt"), n = pendingQ().filter(q => !q.lockedBy).length; c.hidden = !n; c.textContent = n; }
  let lockWarned = null;
  function useReq(q) { chrome.storage.local.set({ sabaReq: { ...q, sentAt: Date.now() }, sabaNavFor: "", sabaAddFor: "", sabaSwFor: "" }); }
  const TYPE_AR = { sick: "إجازة مرضية", companion: "إجازة مرافق", attendance: "مشهد حضور" };
  const LTR = new Set(["fileNo", "idNumber", "companionId", "dob", "companionDob", "phone", "leaveStart", "leaveEnd", "visitDate", "ref", "leaveDays", "patientNameEn"]);

  function diagText() {
    const labs = labelCandidates().filter(x => x.t.length < 45).slice(0, 90);
    const d = el => el ? `${el.tagName.toLowerCase()}[${["type","id","name","formcontrolname","placeholder","readonly","disabled"].map(a => el.getAttribute(a) != null ? a + "=" + el.getAttribute(a) : "").filter(Boolean).join(" ")}] .${String(el.className).slice(0, 60)}` : "-";
    const out = labs.map(x => { const c = controlFor(x.el), g = controlBelow(x.el); return `${x.el.tagName.toLowerCase()} «${x.t}» → ${d(c)}${g && g !== c ? " | geo:" + d(g) : ""}`; });
    const ctrls = deepAll(CONTROL + ", input[type=radio], [role=radio], [role=combobox], [contenteditable=true]").filter(c => !c.closest("#saba-seha-host")).slice(0, 70)
      .map(c => { const r = c.getBoundingClientRect(); return `${c.tagName.toLowerCase()} ${c.type || c.getAttribute("role") || ""} id=${c.id} name=${c.name || ""} fcn=${c.getAttribute("formcontrolname")} ph=${c.placeholder || ""} cls=${String(c.className).slice(0, 50)} vis=${visible(c)} ro=${c.readOnly} @${Math.round(r.left)},${Math.round(r.top)}`; });
    const sh = shadowHosts.map(h => h.tagName.toLowerCase()); const tags = [...new Set(deepAll("*").map(e => e.tagName.toLowerCase()).filter(t => t.includes("-")))].slice(0, 40);
    return location.href + `\nshadow=${sh.length} [${[...new Set(sh)].slice(0, 15).join(",")}] custom=[${tags.join(",")}] ctrlsTotal=${document.querySelectorAll("input,select,textarea").length}` + "\n--labels--\n" + out.join("\n") + "\n--controls--\n" + ctrls.join("\n");
  }
  // نرسل أمر لكل الإطارات ونجمع ردودها
  async function askFrames(cmdKey, repPrefix) {
    const at = Date.now();
    await chrome.storage.local.set({ [cmdKey]: { at } });
    await new Promise(r => setTimeout(r, 1200));
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith(repPrefix));
    const got = keys.map(k => all[k]).filter(v => v && v.at === at);
    if (keys.length) chrome.storage.local.remove(keys);
    return got;
  }
  function render() {
    if (!TOP) return;
    const b = $("#body");
    updateCount();
    if (!req) {
      $("#foot").hidden = true; fixOpen = false;
      const cur = norm(currentAccountText()), pend = pendingQ();
      const here = q => q.account && cur && cur.includes(norm(q.account.key));
      pend.sort((a, b) => (!!a.lockedBy - !!b.lockedBy) || (here(b) - here(a)));     // اللي عند موظف ثاني تنزل تحت
      const free = pend.filter(q => !q.lockedBy);
      const hh = queueAt ? new Date(queueAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) : "";
      b.innerHTML = `<div class="note" style="background:#EAF6FC;color:#0B4A87">⏸ متوقفة — ما تعبّي ولا تبدّل العيادة لين تختار طلب</div>
        ${free.length ? `<button class="btn pri" id="nextReq" style="flex:none">▶ الطلب التالي: ${esc(free[0].patientName || "")}</button>` : ""}
        <div class="qh">الطلبات اللي تنتظر الرفع (${pend.length})</div>
        <div class="ql">${pend.map(q => `<button class="qi ${q.lockedBy ? "lk" : here(q) ? "here" : ""}" data-id="${esc(q.id)}"><b>${esc(q.patientName || "—")}${q.lockedBy ? ` <i class="lkb">🔒 عند ${esc(q.lockedBy)}</i>` : ""}</b><span>${esc(TYPE_AR[q.type] || q.type)} · ${esc(q.account?.key || q.branch || "")}${here(q) ? " · حسابك الحالي" : ""}</span></button>`).join("")
          || `<div class="empty">${queueAt && !queueStale() ? "ما فيه طلبات تنتظر ✓" : queueAt ? "ما فيه طلبات (حسب آخر قائمة وصلت)" : "افتح لوحة سابا عشان تظهر الطلبات هنا، أو اضغط زر صحة من الطلب."}</div>`}</div>
        ${queueStale() ? `<div class="note" style="background:#FFF4E5;color:#8A4B00">⚠ القائمة مو محدّثة${hh ? ` (آخر تحديث ${hh})` : ""} — افتح لوحة سابا، ولو مفتوحة حدّث صفحتها (F5)</div>` : hh ? `<div class="tiny">آخر تحديث من لوحة سابا: ${hh}</div>` : ""}
        <details><summary>لصق طلب يدوي</summary><textarea id="paste" placeholder="الصق هنا (Ctrl+V)"></textarea></details>`;
      const nx = $("#nextReq"); if (nx) nx.onclick = () => useReq(free[0]);
      root.querySelectorAll(".qi").forEach(el => el.onclick = () => {
        const q = queue.find(x => x.id === el.dataset.id); if (!q) return;
        if (q.lockedBy && lockWarned !== q.id) { lockWarned = q.id; return toastLocal(`${q.lockedBy} فاتح هالطلب — لو متأكد اضغط عليه مرة ثانية`); }
        lockWarned = null; useReq(q);
      });
      bindPaste(); return;
    }
    const acc = accountState(req);
    const accTxt = !req.account ? "فرع بدون حساب صحة محدد — تأكد من الحساب يدوياً"
      : acc.state === "ok" ? `✓ أنت في الحساب الصحيح: ${esc(req.account.key)}`
      : acc.state === "wrong" ? `⚠ أنت في حساب ثاني — الطلب لـ <b>${esc(accLabel(req.account))}</b> <button class="btn sec" id="swAcc" style="height:30px;line-height:30px;font-size:12px;margin-top:6px;display:block">بدّل الحساب</button>`
      : acc.state === "picker" ? `اختر الحساب المحدد: <b>${esc(req.account.group)}</b> ← ${esc(req.account.role)}`
      : `الحساب المطلوب: <b>${esc(req.account.group)}</b> ← ${esc(req.account.role)}`;
    const keys = ["idNumber", "dob", "patientName", "phone",
      ...(req.type === "attendance" ? ["visitDate"] : ["leaveStart", "leaveEnd", "leaveDays"]),
      ...(req.type === "companion" ? ["companionName", "companionId", "companionDob", "relationship"] : []),
      "fileNo", "doctorAr", "doctorName", "stampDoctor", "ref"].filter(k => req[k]);
    const okN = keys.filter(k => lastReport[k] === "ok").length;
    const alertHtml = sehaAlert ? `<div class="acc wrong" style="font-weight:600">⚠ صحة أضافت خانة جديدة: ${esc(sehaAlert.labels.join("، "))}<br><span style="font-weight:400">اضغط «تقرير فني» وأرسله لـ Claude عشان أحدّث الإضافة.</span> <button class="lnk" id="alertOk">تمام</button></div>` : "";
    if (!fxType) fxType = req.type;
    const fxFields = FIX_FIELDS.filter(f => !f.types || f.types.includes(fxType));
    const need = fxType === req.type ? [] : fxType === "companion" ? ["companionName", "companionId", "companionDob", "relationship"] : [];
    const lockedNow = queue.find(q => q.id === req.id)?.lockedBy;
    b.innerHTML = `${lockedNow ? `<div class="acc wrong" style="font-weight:600">⚠ ${esc(lockedNow)} فاتح نفس الطلب الحين — تأكدوا مين يرفعه عشان ما ينرفع مرتين</div>` : ""}
      <div class="card ${reqImg?.id === req.id ? "withimg" : ""}">
        ${reqImg?.id === req.id ? `<button class="thumb" id="viewImg" title="افتح صورة التقرير">${reqImg.pdf ? '<span class="pdf">PDF</span>' : '<img alt="">'}<i>🔍</i></button>` : ""}
        <div><div class="nm">${esc(req.patientName)}</div>
        <div class="meta"><span>${esc(TYPE_AR[req.type] || req.type)}</span><span class="ltr">${esc(req.idNumber)}</span><span>${esc(req.ref || "")}</span></div>
        ${reqImg?.id === req.id ? `<button class="lnk" id="viewImg2">📄 صورة التقرير — كبّرها</button>` : `<div class="tiny">صورة التقرير تطلع هنا لما تكون لوحة سابا مفتوحة</div>`}</div>
      </div>
      ${alertHtml}
      <div class="acc ${acc.state}">${accTxt}</div>
      <div class="row"><button class="btn pri" id="fill">تعبئة الخانات</button><button class="btn sec" id="goForm" title="الخدمات ← الإجازات المرضية ← إضافة">افتح النموذج</button></div>
      <div class="links"><label class="tg" style="font-size:12px"><input type="checkbox" id="auto" ${auto ? "checked" : ""}> تعبئة تلقائية</label><button class="lnk" id="closeReq" title="ترجع لقائمة الطلبات بدون رفع">إغلاق الطلب</button><button class="lnk" id="diag">تقرير فني</button></div>
      ${fixOpen ? `<div class="fxbox" id="fxbox"><b style="font-size:13px">نوع الطلب الصحيح</b>
          <div class="chips" id="fxTypes">${["sick", "companion", "attendance"].map(t => `<label><input type="radio" name="fxt" value="${t}" ${t === fxType ? "checked" : ""}>${TYPE_AR[t]}</label>`).join("")}</div>
          ${fxType !== req.type ? `<div class="tiny" style="color:#5B3CC4">بيتحوّل إلى «${TYPE_AR[fxType]}» بعد ما يكمّل المريض البيانات</div>` : ""}
          <b style="font-size:13px">وش الغلط أو الناقص؟ (البوت يرسل للمريض واتساب)</b>
          <div class="chips">${fxFields.map(f => `<label><input type="checkbox" value="${f.k}" ${need.includes(f.k) || fxChecked.includes(f.k) ? "checked" : ""}>${f.ar}</label>`).join("")}</div>
          <textarea id="fxNote" maxlength="200" placeholder="ملاحظة للمريض (اختياري)">${esc(fxNoteVal)}</textarea>
          <div class="row"><button class="btn fx" id="fxSend" style="background:#5B3CC4;color:#fff">أرسل للمريض</button><button class="btn sec" id="fxCancel">إلغاء</button></div></div>` : ""}
      <details class="data" id="data" ${showFields ? "open" : ""}><summary>البيانات (${keys.length})${okN ? ` — ✓ ${okN} تعبّت` : ""}</summary>
      <div class="fl">${keys.map(k => `<div class="f"><span class="s ${lastReport[k] || ""}" data-s="${k}"></span><span class="k">${FIELD_LABELS[k] || k}</span><span class="v ${LTR.has(k) ? "ltr" : ""}" title="${esc(req[k])}">${esc(req[k])}</span><button class="cp" data-k="${k}" title="نسخ">${COPY}</button></div>`).join("")}</div></details>
      <div class="tiny">الإضافة ما تضغط «تحقق» ولا «حفظ» — راجع واضغطها بنفسك.</div>
      <div id="pasteWrap" hidden><div class="lbl">الصق الطلب هنا (Ctrl+V)</div><textarea id="paste"></textarea></div>`;
    const foot = $("#foot"); foot.hidden = false;
    foot.innerHTML = `<button class="btn ok2" id="done" style="flex:none">تم الرفع — حدّث لوحة سابا</button>${fixOpen ? "" : `<button class="btn fx" id="fxOpen" style="flex:none;height:34px;line-height:34px;font-size:13px">✎ طلب تعديل من المريض (واتساب)</button>`}`;
    $("#data").ontoggle = e => { showFields = e.target.open; chrome.storage.local.set({ sabaShowFields: showFields }); };
    const ao = $("#alertOk"); if (ao) ao.onclick = () => { sehaAlert = null; chrome.storage.local.remove("sabaAlert"); render(); };
    const fo = $("#fxOpen"); if (fo) fo.onclick = () => { fixOpen = true; fxType = req.type; fxChecked = []; fxNoteVal = ""; render(); };
    if (fixOpen) {
      setTimeout(() => $("#fxSend")?.scrollIntoView({ block: "nearest" }), 30);
      $("#fxTypes").onchange = e => { fxNoteVal = $("#fxNote").value; fxChecked = [...root.querySelectorAll("#fxbox .chips:not(#fxTypes) input:checked")].map(i => i.value); fxType = e.target.value; render(); };
      $("#fxCancel").onclick = () => { fixOpen = false; fxType = null; fxChecked = []; render(); };
      $("#fxSend").onclick = async () => {
        const fields = [...root.querySelectorAll("#fxbox .chips:not(#fxTypes) input:checked")].map(i => i.value);
        if (!fields.length) return toastLocal("اختر الخانة الغلط");
        const btn = $("#fxSend"); btn.disabled = true; btn.textContent = "يرسل…";
        const at = Date.now(), r0 = req;
        await chrome.storage.local.set({ sabaFixReq: { id: req.id, ref: req.ref, fields, newType: fxType !== req.type ? fxType : "", note: $("#fxNote").value.trim(), at } });
        const res = await new Promise(resolve => {
          const tm = setTimeout(() => { chrome.storage.onChanged.removeListener(l); resolve(null); }, 9000);
          const l = (ch, area) => { const v = ch.sabaFixRes?.newValue; if (area === "local" && v && v.at === at) { clearTimeout(tm); chrome.storage.onChanged.removeListener(l); resolve(v); } };
          chrome.storage.onChanged.addListener(l);
        });
        if (!res) { btn.disabled = false; btn.textContent = "أرسل للمريض"; return toastLocal("لوحة سابا لازم تكون مفتوحة في تبويب ثاني"); }
        if (!res.ok) { btn.disabled = false; btn.textContent = "أرسل للمريض"; return toastLocal(res.msg || "ما انرسل"); }
        fixOpen = false;
        toastLocal(res.auto ? "✓ البوت بيرسل للمريض — الطلب صار «معلّق»" : "البوت مو متصل — أرسلها من لوحة سابا");
        if (!res.auto && res.wa) window.open(res.wa, "_blank");
        chrome.storage.local.set({ sabaHidden: hideId(r0.id) }, () => chrome.storage.local.remove("sabaReq"));
      };
    }
    $("#fill").onclick = async () => {
      if (isSearchPage(norm(deepText()))) { openAddForm(true); return; }
      const r = fill(req, { explicit: true });
      const fr = await askFrames("sabaFillCmd", "sabaRep_");
      fr.forEach(x => Object.assign(r, x.r)); lastReport = { ...lastReport, ...r };
      render(); const n = Object.values(r).filter(v => v === "ok").length;
      toastLocal(n ? `تعبّت ${n} خانة` : "ما لقيت خانات — اضغط «نسخ تقرير فني» وأرسله");
    };
    $("#auto").onchange = e => { auto = e.target.checked; chrome.storage.local.set({ sabaAuto: auto }); };
    $("#goForm").onclick = () => openAddForm(true);
    $("#diag").onclick = async () => {
      const fr = await askFrames("sabaDiagCmd", "sabaDiag_");
      const frames = [...document.querySelectorAll("iframe, frame")].map(f => { const r = f.getBoundingClientRect(); return `iframe src=${String(f.src).slice(0, 140)} id=${f.id} @${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`; });
      const txt = "SABA-DIAG v" + chrome.runtime.getManifest().version + "\n--frames--\n" + (frames.join("\n") || "none") + "\n" + diagText() + fr.map(x => "\n==== FRAME ====\n" + x.txt).join("");
      try { await navigator.clipboard.writeText(txt); } catch { const t = document.createElement("textarea"); t.value = txt; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
      toastLocal(`انسخ التقرير (${fr.length} إطار) — الصقه لـ Claude`);
    };
    $("#closeReq").onclick = () => chrome.storage.local.remove("sabaReq");
    if (reqImg?.id === req.id) {
      const open = () => { try { chrome.runtime.sendMessage({ type: "SABA_OPEN_IMG" }); } catch { toastLocal("حدّث الصفحة (F5) وجرّب"); } };
      $("#viewImg").onclick = open; $("#viewImg2").onclick = open;
      const im = root.querySelector("#viewImg img");
      if (im) { im.onerror = () => { im.remove(); }; im.src = reqImg.url; }          // لو صحة منعت عرض الصورة هنا، الزر يفتحها في تبويب
    }
    $("#done").onclick = () => {
      const psl = newestPsl || "";               // رقم PSL يُلتقط تلقائياً من صفحة صحة (بدون خانة)
      chrome.storage.local.set({ sabaDone: { id: req.id, ref: req.ref, psl, at: Date.now() }, sabaHidden: hideId(req.id) }, () => {
        chrome.storage.local.remove("sabaReq");
        toastLocal("تم ✓ — بيتحدث الطلب في لوحة سابا");
      });
    };
    root.querySelectorAll(".cp").forEach(btn => btn.onclick = async () => {
      const v = String(req[btn.dataset.k] || "");
      try { await navigator.clipboard.writeText(v); } catch { const t = document.createElement("textarea"); t.value = v; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
      btn.style.color = "#0E9F6E"; setTimeout(() => btn.style.color = "", 900);
    });
    bindPaste();
    if (acc.state === "picker") highlightPicker(req);
    const sw = $("#swAcc"); if (sw) sw.onclick = () => switchAccount(true);
  }
  function updateDots() {
    root.querySelectorAll("[data-s]").forEach(d => { d.className = "s " + (lastReport[d.dataset.s] || ""); });
  }
  function bindPaste() {
    const ta = $("#paste"); if (!ta) return;
    ta.addEventListener("paste", e => {
      const t = (e.clipboardData || window.clipboardData).getData("text");
      const m = /SABA_SEHA:(\{[\s\S]*\})/.exec(t || "");
      e.preventDefault();
      if (!m) return toastLocal("هذا مو طلب من لوحة سابا");
      try { useReq(JSON.parse(m[1])); } catch { toastLocal("ما قدرت أقرأ الطلب"); }
    });
  }
  let tt;
  function toastLocal(msg) {
    if (!TOP) return;
    let t = $("#t"); if (!t) { t = document.createElement("div"); t.id = "t"; t.style.cssText = "position:absolute;bottom:100%;left:0;margin-bottom:8px;background:#003765;color:#fff;padding:8px 12px;border-radius:10px;font-size:13px;direction:rtl;white-space:nowrap"; $("#p").parentNode.append(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2200);
  }
  // سحب اللوحة من رأسها لأي مكان (وتنحفظ)، والضغط بدون سحب = تصغير/تكبير
  const clampPos = (x, y) => [Math.max(4, Math.min(innerWidth - 60, x)), Math.max(4, Math.min(innerHeight - 40, y))];
  function placeAt(x, y) { [x, y] = clampPos(x, y); host.style.left = x + "px"; host.style.top = y + "px"; host.style.bottom = "auto"; }
  {
    const hd = $("#hd"); let st = null;
    hd.addEventListener("pointerdown", e => { if (e.button !== 0) return; const r = host.getBoundingClientRect(); st = { x: e.clientX, y: e.clientY, l: r.left, t: r.top, moved: false }; hd.setPointerCapture(e.pointerId); });
    hd.addEventListener("pointermove", e => {
      if (!st) return; const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.moved && Math.hypot(dx, dy) < 5) return;
      st.moved = true; hd.classList.add("drag"); placeAt(st.l + dx, st.t + dy);
    });
    hd.addEventListener("pointerup", () => {
      if (!st) return; const moved = st.moved; st = null; hd.classList.remove("drag");
      if (moved) { const r = host.getBoundingClientRect(); chrome.storage.local.set({ sabaPos: { x: r.left, y: r.top } }); return; }
      setMin(!minimized); if (!minimized) render();
    });
    hd.addEventListener("dblclick", () => { host.style.left = "16px"; host.style.top = "auto"; host.style.bottom = "16px"; chrome.storage.local.remove("sabaPos"); });
    addEventListener("resize", () => { if (host.style.top && host.style.top !== "auto") placeAt(parseFloat(host.style.left), parseFloat(host.style.top)); });
  }

  // ---------- استلام الطلب عن طريق اسم النافذة (احتياط لو الجسر ما اشتغل) ----------
  try {
    if (String(window.name).startsWith("SABA_SEHA:")) {
      const payload = JSON.parse(window.name.slice(10)); window.name = "";
      chrome.storage.local.set({ sabaReq: payload, sabaNavFor: "", sabaAddFor: "", sabaSwFor: "" });
    }
  } catch (e) { console.warn("saba name", e); }

  // ---------- فتح نموذج «إضافة إجازة مرضية» تلقائياً ----------
  // (فتح النموذج ما يخصم نقاط — الخصم يكون عند «تحقق/حفظ» واللي ما نضغطها أبداً)
  const textEls = t => {
    const all = deepAll("a, button, span, li, div, p")
      .filter(el => !el.closest("#saba-seha-host") && el.childElementCount <= 2 && norm(el.textContent) === norm(t));
    return all.filter(el => !all.some(o => o !== el && el.contains(o)));   // الأعمق فقط
  };
  const clickable = el => el.closest("a, button, [role=button], [role=menuitem]") || el;
  const evAt = el => { const r = el.getBoundingClientRect(); return { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; };
  const realClick = el => { el = clickable(el); const o = evAt(el);
    [["pointerdown", PointerEvent], ["mousedown", MouseEvent], ["pointerup", PointerEvent], ["mouseup", MouseEvent], ["click", MouseEvent]].forEach(([t, C]) => el.dispatchEvent(new C(t, o))); };
  // قائمة «الخدمات» في صحة تنفتح بمرور الماوس (مو بالضغط)
  const hover = el => { for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) { const o = evAt(el);
    [["pointerover", PointerEvent], ["mouseover", MouseEvent], ["mousemove", MouseEvent]].forEach(([t, C]) => n.dispatchEvent(new C(t, o)));
    [["pointerenter", PointerEvent], ["mouseenter", MouseEvent]].forEach(([t, C]) => n.dispatchEvent(new C(t, { ...o, bubbles: false }))); } };
  let navBusy = false, navRef = "", navTries = 0, navNext = 0, navUntil = Date.now() + 120000;
  async function openAddForm(force) {
    if (!TOP || navBusy || !req) return;
    const t = norm(deepText());
    if (isFormPage(t)) return;                                                   // النموذج مفتوح
    if (/حسابات صحه طبي|تسجيل الدخول/.test(t) && !/مرحبا بك/.test(t)) return;   // لسى ما دخل / يختار الحساب
    if (accountState(req).state === "wrong") { if (auto || force) await switchAccount(force); return; }   // الحساب غلط → نبدّله أول
    if (navRef !== req.ref) { navRef = req.ref; navTries = 0; navNext = 0; }
    if (!force && Date.now() < navNext) return;
    navBusy = true;
    try {
      const st = await chrome.storage.local.get(["sabaNavFor", "sabaAddFor"]);
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const find = async (txt, tries) => { for (let i = 0; i < tries; i++) { const el = textEls(txt).find(visible); if (el) return el; await wait(250); } return null; };
      const r0 = req;
      const clickAdd = async add => { if (req !== r0) return; await chrome.storage.local.set({ sabaAddFor: req.ref }); realClick(add); toastLocal("فتحت نموذج إضافة الإجازة"); };
      // 1) صفحة البحث مفتوحة وفيها زر الإضافة → نضغطه (مرة لكل طلب، أو دايماً لو ضغط الموظف «افتح النموذج»)
      let add = textEls("إضافة إجازة مرضية").find(visible);
      if (add) { if (force || st.sabaAddFor !== req.ref) await clickAdd(add); return; }
      // 2) من الصفحة الرئيسية: الخدمات ← الإجازات المرضية (نعيد المحاولة لين تحمّل القائمة)
      if (!force && navTries >= 6) return;
      navTries++; navNext = Date.now() + 2500;
      let link = textEls("الإجازات المرضية").find(visible);
      if (!link) {
        const svc = await find("الخدمات", 12); if (!svc) return;
        hover(svc); link = await find("الإجازات المرضية", 6);                       // تنفتح بالمرور
        if (!link) { realClick(svc); hover(svc); link = await find("الإجازات المرضية", 8); }
        if (!link) link = textEls("الإجازات المرضية")[0] || null;                   // موجودة بس مخفية → نضغطها مباشرة
      }
      if (req !== r0) return;                                                     // انقفل الطلب أثناء التنقل
      if (!link) { if (navTries >= 6 || force) toastLocal("افتح: الخدمات ← الإجازات المرضية ← إضافة"); return; }
      await chrome.storage.local.set({ sabaNavFor: req.ref });
      hover(link); realClick(link);
      add = await find("إضافة إجازة مرضية", 60);                                  // نستنى صفحة البحث لين 15 ثانية
      if (add && (force || st.sabaAddFor !== req.ref)) await clickAdd(add);
    } finally { navBusy = false; }
  }
  // الصفحة الرئيسية أحياناً تحمّل بدون تغييرات نلقطها — نحاول كل ثانيتين لمدة دقيقتين بعد وصول الطلب
  setInterval(() => { if (alive() && TOP && auto && navActive() && !document.hidden) openAddForm(); }, 2000);

  // القائمة تتحدث كل دقيقة من اللوحة — لو وقفت نبيّن تنبيه
  let lastStale = null;
  setInterval(() => { if (!alive() || !TOP || req || minimized) return; const st = queueStale(); if (st !== lastStale) { lastStale = st; render(); } }, 20000);

  // ---------- تشغيل ----------
  chrome.storage.local.get("sabaReqImg", d => { reqImg = d.sabaReqImg || null; if (reqImg && req?.id === reqImg.id) render(); });
  chrome.storage.local.get(["sabaReq", "sabaAuto", "sabaQueue", "sabaHidden", "sabaPos", "sabaShowFields", "sabaAlert"], d => {
    req = d.sabaReq || null; auto = d.sabaAuto !== false; showFields = !!d.sabaShowFields; sehaAlert = d.sabaAlert || null;
    if (TOP && d.sabaPos) placeAt(d.sabaPos.x, d.sabaPos.y);
    queue = d.sabaQueue?.items || []; queueAt = d.sabaQueue?.at || 0; hidden = d.sabaHidden || {}; chrome.storage.local.remove("sabaDoneIds");
    if (req && !fillActive()) { req = null; if (TOP) chrome.storage.local.remove("sabaReq"); }   // طلب قديم → نتجاهله
    setMin(!req);                                                                             // بدون طلب: اللوحة مصغّرة وما تزعج
    if (TOP) document.documentElement.append(host);
    render();
    if (req && auto) setTimeout(() => { fill(req); render(); if (navActive()) openAddForm(); }, 900);
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (!TOP && ch.sabaFillCmd?.newValue && req) { const r = fill(req, { explicit: true }); chrome.storage.local.set({ ["sabaRep_" + FID]: { at: ch.sabaFillCmd.newValue.at, r } }); }
    if (!TOP && ch.sabaDiagCmd?.newValue) chrome.storage.local.set({ ["sabaDiag_" + FID]: { at: ch.sabaDiagCmd.newValue.at, txt: diagText() } });
    if (ch.sabaAuto) auto = ch.sabaAuto.newValue !== false;
    if (ch.sabaAlert && TOP) { sehaAlert = ch.sabaAlert.newValue || null; if (sehaAlert) { setMin(false); toastLocal("⚠ صحة أضافت خانة جديدة"); } render(); }
    if (ch.sabaQueue) {
      const sig = () => JSON.stringify(pendingQ().map(q => [q.id, q.type, q.branch, q.patientName, q.lockedBy || ""]));
      const lk = () => req ? queue.find(q => q.id === req.id)?.lockedBy || "" : "";
      const before = sig(), wasStale = queueStale(), lkBefore = lk();
      queue = ch.sabaQueue.newValue?.items || []; queueAt = ch.sabaQueue.newValue?.at || 0;
      if (req) { updateCount(); if (lk() !== lkBefore) render(); }               // تنبيه «فلان فاتح نفس الطلب»
      else if (before === sig() && wasStale === queueStale()) updateCount();  // نبضة كل دقيقة بدون تغيير → لا نعيد الرسم
      else if (!minimized) render(); else updateCount();
    }
    if (ch.sabaHidden) hidden = ch.sabaHidden.newValue || {};
    if (ch.sabaReqImg && TOP) { reqImg = ch.sabaReqImg.newValue || null; if (req && (!reqImg || reqImg.id === req.id)) render(); }
    if (ch.sabaReq) {
      req = ch.sabaReq.newValue || null; lastReport = {}; newestPsl = ""; fixOpen = false;
      if (req) { setMin(false); render(); if (auto) setTimeout(() => { fill(req); render(); openAddForm(); }, 300); toastLocal("وصل طلب جديد من سابا"); }
      else { setMin(!pendingQ().length); render(); }                    // بعد «تم الرفع»: قائمة الطلبات التالية، أو تتصغّر لو ما فيه
    }
    if (!TOP && ch.sabaReq) return;
  });

  // صحة تطبيق صفحة واحدة: نراقب تغيّر الصفحة وظهور خانات جديدة
  let deb;
  const mo = new MutationObserver(muts => {
    if (!alive()) { mo.disconnect(); return; }
    if (muts.every(m => host.contains(m.target) || m.target === host)) return;
    clearTimeout(deb);
    deb = setTimeout(() => {
      scanPsl(); healthCheck();
      if (auto && fillActive()) { fill(req); updateDots(); if (navActive()) openAddForm(); }
      const pslIn = $("#psl"); if (pslIn && newestPsl && !pslIn.value) pslIn.value = newestPsl;
      const acc = $(".acc"); if (req && acc) { const st = accountState(req).state; if (!acc.classList.contains(st)) render(); }
      if (req && /حسابات صحة طبي/.test(document.body.innerText)) highlightPicker(req);
    }, 450);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  setInterval(() => { if (alive() && auto && fillActive() && shadowHosts.length && !document.hidden) { fill(req); updateDots(); } }, 2000);
  addEventListener("hashchange", () => setTimeout(() => render(), 500));
})();
