/* ==========================================================================
   سابا ← صحة : لوحة عائمة داخل منصة صحة تعبّي نموذج الإجازة من طلب سابا
   - ما يضغط "تحقق" ولا "حفظ" أبداً (كل طلب يخصم نقاط) — الموظف يضغطها بنفسه
   - يعبّي الخانات الفاضية بس، وما يكتب فوق شي عدّله الموظف
   ========================================================================== */
(() => {
  if (window.__sabaSeha) return; window.__sabaSeha = true;

  // ---------- إعدادات يمكن تعديلها ----------
  const DATE_FMT = "DD/MM/YYYY";           // شكل التاريخ في خانات صحة (غيّره إلى "YYYY-MM-DD" إذا لزم)
  const TYPE_LABEL = {                      // نوع الإجازة في صحة لكل نوع طلب في سابا
    sick: "إجازة مرضية اعتيادية",
    companion: "إجازة مرافق",
    attendance: "مشهد مراجعة",
  };
  const ID_TYPE = { "1": "مواطن", "2": "مقيم" };

  // ---------- أدوات ----------
  const norm = s => String(s || "")
    .replace(/[ً-ْـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
  const fmtDate = dmy => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy || ""); if (!m) return dmy || "";
    return DATE_FMT.replace("DD", m[1]).replace("MM", m[2]).replace("YYYY", m[3]);
  };
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
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
  const G = k => r => fmtDate(r[k]);                    // ميلادي
  const H = k => r => fmtDate(toHijriDmy(r[k]));        // هجري
  const startOf = r => r.type === "attendance" ? (r.visitDate || r.leaveStart) : r.leaveStart;
  const notAtt = r => r.type === "attendance", onlyAtt = r => r.type !== "attendance", onlyComp = r => r.type !== "companion";
  const RULES = [
    // الخطوة 1
    { key: "companionId", re: /هويه المرافق|اقامه المرافق/, skipIf: onlyComp },
    { key: "idNumber",    re: /رقم (ال)?هويه|رقم (ال)?اقامه|الهويه\/الاقامه/, not: /^(?!.*المريض).*المرافق/ },
    { key: "dob",         re: /الميلاد\/?\s*ميلادي/, not: /المرافق/, val: G("dob") },
    { key: "dob",         re: /الميلاد\/?\s*هجري/, not: /المرافق/, val: H("dob"), hijri: true },
    // الخطوة 2 — معلومات مقدم الطلب
    { key: "fileNo",      re: /رقم السجل الطبي|رقم الملف الطبي/ },
    { key: "phone",       re: /(رقم )?(الجوال|الهاتف|المحمول)/, val: (r, el) => {
        const p = String(r.phone || "").replace(/\D/g, "").replace(/^966/, "").replace(/^0/, "");
        const has966 = /966/.test(el.parentElement?.textContent || "") || /966/.test(el.closest("div")?.parentElement?.textContent || "");
        return has966 || el.maxLength === 9 ? p : "0" + p; } },
    { key: "leaveStart",  re: /تاريخ الدخول ميلادي/, val: r => fmtDate(startOf(r)) },
    { key: "leaveStart",  re: /تاريخ الدخول هجري/, val: r => fmtDate(toHijriDmy(startOf(r))), hijri: true },
    { key: "visitDate",   re: /^تاريخ المراجعه ميلادي|تاريخ (الزياره|الحضور)/, val: G("visitDate"), skipIf: onlyAtt },
    { key: "visitDate",   re: /^تاريخ المراجعه هجري/, val: H("visitDate"), hijri: true, skipIf: onlyAtt },
    // الخطوة 2 — التوصيات
    { key: "leaveDays",   re: /منحه اجازه( مرضيه)? لمده|(مده|عدد ايام) الاجازه|عدد الايام/, skipIf: notAtt },
    { key: "leaveStart",  re: /^من تاريخ ميلادي|(تاريخ )?(بدايه|بدء) الاجازه/, val: G("leaveStart"), skipIf: notAtt },
    { key: "leaveStart",  re: /^من تاريخ هجري/, val: H("leaveStart"), hijri: true, skipIf: notAtt },
    { key: "leaveEnd",    re: /(تاريخ )?(نهايه|انتهاء) الاجازه/, val: G("leaveEnd"), skipIf: notAtt },
    // المرافق
    { key: "companionName", re: /اسم المرافق/, skipIf: onlyComp },
    { key: "companionDob",  re: /ميلاد المرافق.*ميلادي|ميلاد المرافق$/, val: G("companionDob"), skipIf: onlyComp },
    { key: "companionDob",  re: /ميلاد المرافق.*هجري/, val: H("companionDob"), hijri: true, skipIf: onlyComp },
    { key: "relationship",  re: /صله القرابه|القرابه/, skipIf: onlyComp },
  ];
  const FIELD_LABELS = {
    idNumber: "رقم الهوية", fileNo: "رقم الملف", dob: "تاريخ الميلاد", patientName: "اسم المريض", patientNameEn: "الاسم بالإنجليزي", phone: "الجوال",
    leaveStart: "بداية الإجازة", leaveEnd: "نهاية الإجازة", leaveDays: "عدد الأيام", visitDate: "تاريخ الحضور",
    companionName: "اسم المرافق", companionId: "هوية المرافق", companionDob: "ميلاد المرافق", relationship: "صلة القرابة",
    doctorName: "الطبيب", doctorAr: "الطبيب المرخّص", stampDoctor: "ختم الطبيب", reason: "السبب", nationality: "الجنسية", gender: "الجنس", ref: "رقم طلب سابا",
  };

  // ---------- إيجاد الخانة من عنوانها ----------
  function labelCandidates() {
    return [...document.querySelectorAll("label, legend, span, div, p, td, th, h5, h6, small, strong, b")]
      .filter(el => el.childElementCount <= 1 && visible(el) && !el.closest("#saba-seha-host"))
      .map(el => ({ el, t: norm(el.textContent) }))
      .filter(x => x.t && x.t.length <= 60);
  }
  function controlFor(labelEl) {
    if (labelEl.htmlFor) { const c = document.getElementById(labelEl.htmlFor); if (c && c.matches(CONTROL)) return c; }
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
    const cands = [...document.querySelectorAll("label, span, div")]
      .filter(el => visible(el) && !el.closest("#saba-seha-host") && norm(el.textContent) === want);
    for (const el of cands) {
      const r = el.querySelector("input[type=radio]") || (el.htmlFor && document.getElementById(el.htmlFor))
        || (el.previousElementSibling?.matches?.("input[type=radio]") && el.previousElementSibling)
        || (el.nextElementSibling?.matches?.("input[type=radio]") && el.nextElementSibling)
        || el.parentElement?.querySelector(":scope > input[type=radio]");
      if (r) { if (!r.checked) { r.click(); if (!r.checked) el.click(); } return true; }
    }
    return false;
  }

  // ---------- التعبئة ----------
  const filledEls = new WeakSet();
  let lastReport = {};
  function fillPass(req, labs, report, hijriPass) {
    for (const rule of RULES) {
      if (!!rule.hijri !== hijriPass || rule.skipIf?.(req)) continue;
      const lab = labs.find(x => rule.re.test(x.t) && !(rule.not && rule.not.test(x.t)));
      if (!lab) continue;
      const c = controlFor(lab.el);
      if (!c || c.disabled) continue;
      const val = rule.val ? rule.val(req, c) : String(req[rule.key] || "");
      if (!val) continue;
      if (c.value) { if (!hijriPass) report[rule.key] = report[rule.key] || "ok"; continue; } // ما نكتب فوق شي موجود
      if (filledEls.has(c)) continue;
      if (c instanceof HTMLSelectElement) { if (!pickOption(c, val)) continue; }
      else setValue(c, val);
      filledEls.add(c); flash(c);
      if (!hijriPass) report[rule.key] = norm(c.value) === norm(val) ? "ok" : "check";
    }
  }
  function fill(req, { explicit = false } = {}) {
    if (!req) return {};
    const report = {};
    // 1) نوع الإجازة
    const typeText = TYPE_LABEL[req.type];
    if (typeText && norm(document.body.innerText).includes("نوع الاجازه")) {
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
    // 3) الميلادي والنصوص، وبعدها الهجري (لو صحة ما حسبته لحالها)
    fillPass(req, labelCandidates(), report, false);
    setTimeout(() => fillPass(req, labelCandidates(), {}, true), 700);
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
      .filter(x => x.r.top >= 0 && x.r.top < 110 && x.t.length < 120 && /مجمع|شركة|عيادات/.test(x.t))
      .map(x => x.t).join(" | ");
  }
  function accountState(req) {
    const acc = req?.account; if (!acc) return { state: "unknown" };
    const onPicker = /حسابات صحة طبي/.test(document.body.innerText);
    if (onPicker) return { state: "picker" };
    const cur = currentAccountText();
    if (!cur) return { state: "unknown" };
    return { state: cur.includes(acc.key) ? "ok" : "wrong", cur };
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
    const found = document.body.innerText.match(PSL_RE) || [];
    for (const p of found) if (!seenPsl.has(p)) { seenPsl.add(p); newestPsl = p; }
  }

  // ---------- اللوحة العائمة (Shadow DOM حتى ما تتأثر بتصميم صحة) ----------
  const host = document.createElement("div"); host.id = "saba-seha-host";
  host.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483646;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
  <style>
    :host{all:initial}
    *{box-sizing:border-box;font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif}
    .p{direction:rtl;width:340px;max-height:78vh;display:flex;flex-direction:column;background:#fff;color:#0B2B47;border:1px solid #DCEBF4;border-radius:18px;box-shadow:0 18px 50px -12px rgba(0,55,101,.35);overflow:hidden}
    .h{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#003765;color:#fff;cursor:pointer;user-select:none}
    .h b{font-size:14px;flex:1}
    .h .dot{width:9px;height:9px;border-radius:50%;background:#7FD0F0}
    .h button{all:unset;cursor:pointer;color:#BFE6F7;font-size:18px;line-height:1;padding:0 4px}
    .b{padding:12px;overflow:auto;display:grid;gap:10px}
    .card{border:1px solid #DCEBF4;border-radius:12px;padding:10px}
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
    .note{font-size:12px;color:#8A5A12;background:#FFF7EA;border-radius:8px;padding:6px 8px}
  </style>
  <div class="p" id="p">
    <div class="h" id="hd"><span class="dot"></span><b>سابا ← صحة</b><button id="min" title="تصغير">–</button></div>
    <div class="b" id="body"></div>
  </div>`;
  const $ = s => root.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COPY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';

  let req = null, auto = true, minimized = false;
  const TYPE_AR = { sick: "إجازة مرضية", companion: "إجازة مرافق", attendance: "مشهد حضور" };
  const LTR = new Set(["fileNo", "idNumber", "companionId", "dob", "companionDob", "phone", "leaveStart", "leaveEnd", "visitDate", "ref", "leaveDays", "patientNameEn"]);

  function render() {
    const b = $("#body");
    if (!req) {
      b.innerHTML = `<div class="empty">افتح الطلب من <b>لوحة سابا</b> واضغط «افتح منصة صحة للرفع»، وبيوصل هنا تلقائياً.</div>
        <div><div class="lbl">أو الصق الطلب هنا (Ctrl+V)</div><textarea id="paste" placeholder="الصق هنا"></textarea></div>`;
      bindPaste(); return;
    }
    const acc = accountState(req);
    const accTxt = !req.account ? "فرع بدون حساب صحة محدد — تأكد من الحساب يدوياً"
      : acc.state === "ok" ? `✓ أنت في الحساب الصحيح: ${esc(req.account.group)}`
      : acc.state === "wrong" ? `⚠ أنت في حساب ثاني! الطلب لحساب: ${esc(req.account.group)} ← ${esc(req.account.role)}`
      : acc.state === "picker" ? `اختر الحساب المحدد: <b>${esc(req.account.group)}</b> ← ${esc(req.account.role)}`
      : `الحساب المطلوب: <b>${esc(req.account.group)}</b> ← ${esc(req.account.role)}`;
    const keys = ["idNumber", "dob", "patientName", "patientNameEn", "phone",
      ...(req.type === "attendance" ? ["visitDate"] : ["leaveStart", "leaveEnd", "leaveDays"]),
      ...(req.type === "companion" ? ["companionName", "companionId", "companionDob", "relationship"] : []),
      "fileNo", "doctorAr", "doctorName", "stampDoctor", "reason", "nationality", "ref"].filter(k => req[k]);
    b.innerHTML = `
      <div class="card">
        <div class="nm">${esc(req.patientName)}</div>
        <div class="meta"><span>${esc(TYPE_AR[req.type] || req.type)}</span><span class="ltr">${esc(req.idNumber)}</span><span>نوع صحة: ${esc(TYPE_LABEL[req.type] || "")}</span></div>
      </div>
      <div class="acc ${acc.state}">${accTxt}</div>
      <div class="row"><button class="btn pri" id="fill">تعبئة الخانات</button><button class="btn sec" id="goForm" title="الخدمات ← الإجازات المرضية ← إضافة">افتح النموذج</button><button class="btn sec" id="pasteBtn" title="لصق طلب ثاني">طلب آخر</button></div>
      <label class="tg"><input type="checkbox" id="auto" ${auto ? "checked" : ""}> تعبئة تلقائية لما تظهر خانات جديدة</label>
      <div class="note">الإضافة ما تضغط «تحقق» ولا «حفظ» — راجع واضغطها بنفسك.</div>
      <div class="fl">${keys.map(k => `<div class="f"><span class="s ${lastReport[k] || ""}" data-s="${k}"></span><span class="k">${FIELD_LABELS[k] || k}</span><span class="v ${LTR.has(k) ? "ltr" : ""}" title="${esc(req[k])}">${esc(req[k])}</span><button class="cp" data-k="${k}" title="نسخ">${COPY}</button></div>`).join("")}</div>
      <div><div class="lbl">رقم الإجازة في صحة (PSL…)</div><input class="psl" id="psl" placeholder="PSL…" value="${esc(newestPsl)}"></div>
      <button class="btn ok2" id="done">تم الرفع — حدّث لوحة سابا</button>
      <div id="pasteWrap" hidden><div class="lbl">الصق الطلب هنا (Ctrl+V)</div><textarea id="paste"></textarea></div>`;
    $("#fill").onclick = () => { const r = fill(req, { explicit: true }); render(); toastLocal(Object.keys(r).length ? `تعبّت ${Object.values(r).filter(v => v === "ok").length} خانة` : "ما لقيت خانات في هالصفحة"); };
    $("#auto").onchange = e => { auto = e.target.checked; chrome.storage.local.set({ sabaAuto: auto }); };
    $("#goForm").onclick = () => openAddForm(true);
    $("#pasteBtn").onclick = () => { $("#pasteWrap").hidden = false; $("#paste").focus(); };
    $("#done").onclick = () => {
      const psl = $("#psl").value.trim();
      chrome.storage.local.set({ sabaDone: { id: req.id, ref: req.ref, psl, at: Date.now() } }, () => toastLocal("تم — بيتحدث الطلب في لوحة سابا"));
    };
    root.querySelectorAll(".cp").forEach(btn => btn.onclick = async () => {
      const v = String(req[btn.dataset.k] || "");
      try { await navigator.clipboard.writeText(v); } catch { const t = document.createElement("textarea"); t.value = v; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
      btn.style.color = "#0E9F6E"; setTimeout(() => btn.style.color = "", 900);
    });
    bindPaste();
    if (acc.state === "picker") highlightPicker(req);
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
      try { chrome.storage.local.set({ sabaReq: JSON.parse(m[1]), sabaNavFor: "" }); } catch { toastLocal("ما قدرت أقرأ الطلب"); }
    });
  }
  let tt;
  function toastLocal(msg) {
    let t = $("#t"); if (!t) { t = document.createElement("div"); t.id = "t"; t.style.cssText = "position:absolute;bottom:100%;left:0;margin-bottom:8px;background:#003765;color:#fff;padding:8px 12px;border-radius:10px;font-size:13px;direction:rtl;white-space:nowrap"; $("#p").parentNode.append(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2200);
  }
  $("#hd").onclick = () => { minimized = !minimized; $("#p").classList.toggle("min", minimized); $("#min").textContent = minimized ? "+" : "–"; chrome.storage.local.set({ sabaMin: minimized }); };

  // ---------- استلام الطلب عن طريق اسم النافذة (احتياط لو الجسر ما اشتغل) ----------
  try {
    if (String(window.name).startsWith("SABA_SEHA:")) {
      const payload = JSON.parse(window.name.slice(10)); window.name = "";
      chrome.storage.local.set({ sabaReq: payload, sabaNavFor: "" });
    }
  } catch (e) { console.warn("saba name", e); }

  // ---------- فتح نموذج «إضافة إجازة مرضية» تلقائياً ----------
  // (فتح النموذج ما يخصم نقاط — الخصم يكون عند «تحقق/حفظ» واللي ما نضغطها أبداً)
  const textEls = t => {
    const all = [...document.querySelectorAll("a, button, span, li, div, p")]
      .filter(el => !el.closest("#saba-seha-host") && el.childElementCount <= 2 && norm(el.textContent) === norm(t));
    return all.filter(el => !all.some(o => o !== el && el.contains(o)));   // الأعمق فقط
  };
  const clickable = el => el.closest("a, button, [role=button], [role=menuitem]") || el.closest("li") || el;
  const realClick = el => { el = clickable(el); ["mousedown", "mouseup", "click"].forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))); };
  const onAddForm = () => norm(document.body.innerText).includes("اضافه اجازه مرضيه") && !!document.querySelector("input[type=radio]");
  let navBusy = false;
  async function openAddForm(force) {
    if (navBusy || !req || onAddForm()) return;
    const navFor = (await chrome.storage.local.get("sabaNavFor")).sabaNavFor;
    if (!force && navFor === req.ref) return;                 // مرة وحدة لكل طلب
    if (/حسابات صحة طبي|تسجيل الدخول/.test(document.body.innerText) && !/مرحبا بك/.test(document.body.innerText)) return; // لسى ما دخل
    navBusy = true;
    try {
      await chrome.storage.local.set({ sabaNavFor: req.ref });
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const find = async (t, tries = 12) => { for (let i = 0; i < tries; i++) { const el = textEls(t).find(visible) || textEls(t)[0]; if (el) return el; await wait(250); } return null; };
      // 1) زر الإضافة موجود؟ (صفحة الإجازات مفتوحة)
      let add = textEls("إضافة إجازة مرضية").find(visible);
      if (!add) {
        let link = textEls("الإجازات المرضية").find(visible);
        if (!link) { const svc = await find("الخدمات", 4); if (svc) { realClick(svc); await wait(400); } link = await find("الإجازات المرضية", 8); }
        if (link) { realClick(link); add = await find("إضافة إجازة مرضية", 20); }
      }
      if (add) { realClick(add); toastLocal("فتحت نموذج إضافة الإجازة"); }
      else toastLocal("افتح: الخدمات ← الإجازات المرضية ← إضافة");
    } finally { navBusy = false; }
  }

  // ---------- تشغيل ----------
  chrome.storage.local.get(["sabaReq", "sabaAuto", "sabaMin"], d => {
    req = d.sabaReq || null; auto = d.sabaAuto !== false; minimized = !!d.sabaMin;
    $("#p").classList.toggle("min", minimized); $("#min").textContent = minimized ? "+" : "–";
    document.documentElement.append(host);
    render();
    if (req && auto) setTimeout(() => { fill(req); render(); openAddForm(); }, 900);
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch.sabaReq) { req = ch.sabaReq.newValue || null; lastReport = {}; newestPsl = ""; if (minimized) { minimized = false; $("#p").classList.remove("min"); } render(); if (req && auto) setTimeout(() => { fill(req); render(); openAddForm(); }, 300); toastLocal("وصل طلب جديد من سابا"); }
  });

  // صحة تطبيق صفحة واحدة: نراقب تغيّر الصفحة وظهور خانات جديدة
  let deb;
  new MutationObserver(muts => {
    if (muts.every(m => host.contains(m.target) || m.target === host)) return;
    clearTimeout(deb);
    deb = setTimeout(() => {
      scanPsl();
      if (req && auto) { fill(req); updateDots(); openAddForm(); }
      const pslIn = $("#psl"); if (pslIn && newestPsl && !pslIn.value) pslIn.value = newestPsl;
      const acc = $(".acc"); if (req && acc) { const st = accountState(req).state; if (!acc.classList.contains(st)) render(); }
      if (req && /حسابات صحة طبي/.test(document.body.innerText)) highlightPicker(req);
    }, 450);
  }).observe(document.body, { childList: true, subtree: true });
  addEventListener("hashchange", () => setTimeout(() => render(), 500));
})();
