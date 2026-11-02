// صفحة البحث الحقيقية: صحة تفتحها داخل إطار (iframe) من sickleave.seha.sa — الخانات والجدول هنا، مو في الصفحة الأم.
// ⚠ نضغط بس: «إعادة تعيين» و«بحث» و«عرض» (العين). أبداً: إضافة، تحقق، حفظ، تعديل، طباعة، تحديث، دفع.
(() => {
  if (window.__sabaFrame || !/(^|\.)sickleave\.seha\.sa$/i.test(location.hostname)) return; window.__sabaFrame = true;
  const { norm, T, visible, sleep, waitFor, setValue } = A;
  const $ = s => document.querySelector(s);
  const LOGS = []; let LOG = [];
  const L = t => { LOG.push(new Date().toLocaleTimeString("en-GB", { hour12: false }) + " " + t); };

  // رجعنا من صفحة «عرض» (لو فتحت صفحة بدل نافذة) → نرجع لصفحة البحث
  try {
    const back = +sessionStorage.getItem("sabaViewBack") || 0;
    if (back && Date.now() - back < 120e3 && !$("#SickLeaveTbl")) { sessionStorage.removeItem("sabaViewBack"); history.back(); }
    else if (back && $("#SickLeaveTbl")) sessionStorage.removeItem("sabaViewBack");
  } catch {}

  const idInput = () => $("#IdNumber") || $("input[name=IdNumber]");
  const searchBtn = () => $("#search") || $("input[type=button][onclick^='Search']") || [...document.querySelectorAll("input[type=button], button")].find(b => /^بحث$/.test(norm(b.value || b.textContent)));
  const resetBtn = () => $("button[onclick*='ResetFilters']") || $(".btn-reset") || [...document.querySelectorAll("button")].find(b => /اعاده تعيين/.test(norm(b.textContent)));
  const tbl = () => $("#SickLeaveTbl") || [...document.querySelectorAll("table")].find(t => /رمز الخدمه/.test(norm(t.textContent)));
  const loading = () => { const l = $(".loading"); return !!l && getComputedStyle(l).display !== "none" && visible(l); };
  const ready = () => !!(idInput() && searchBtn() && tbl());
  const sig = () => { const t = tbl(); return t ? (t.tBodies[0]?.textContent || "").replace(/\s+/g, " ") : "∅"; };

  function state() {
    return { ready: ready(), path: location.pathname, loading: loading(), title: T(document.title).slice(0, 60),
      text: ready() ? "" : T(document.body?.innerText || "").slice(0, 160) };   // لو الصفحة مو صفحة البحث: أول سطر منها (مثلاً «انتهت الجلسة»)
  }

  // نضغط وننتظر لين يخلص التحميل ويتغيّر الجدول (أو يثبت)
  async function clickAndWait(el, label) {
    const before = sig();
    el.click();
    const t0 = Date.now();
    await waitFor(() => loading() || sig() !== before, 4000, 100);
    await waitFor(() => !loading(), 30000, 150);
    // نستنى الجدول يثبت 700ms
    let last = sig(), stable = Date.now();
    while (Date.now() - t0 < 32000) { await sleep(200); const s = sig(); if (s !== last) { last = s; stable = Date.now(); } else if (Date.now() - stable > 700 && !loading()) break; }
    L(`${label}: خلص بعد ${((Date.now() - t0) / 1000).toFixed(1)} ث${sig() === before ? " (الجدول ما تغيّر)" : ""}`);
    return sig() !== before;
  }

  const COLS = [[/اسم المريض/, "name"], [/نوع الهويه/, "idType"], [/رقم الهويه|الاقامه/, "id"], [/جوال/, "phone"], [/رمز الخدمه/, "psl"], [/حاله ?الطلب/, "status"], [/تاريخ الطلب/, "date"], [/حاله ?الدفع/, "pay"], [/نوع الاجازه/, "type"]];
  function parseTable() {
    const t = tbl(); if (!t) return { rows: [], trs: [], keys: [] };
    const ths = [...(t.tHead || t).querySelectorAll("th")];
    const keys = ths.map(th => (COLS.find(([re]) => re.test(norm(th.textContent))) || [, ""])[1]);
    const trs = [...(t.tBodies[0] || t).querySelectorAll(":scope > tr")].filter(tr => tr.cells.length >= 4 && !tr.querySelector(".dataTables_empty"));
    const rows = trs.map(tr => {
      const o = {};
      keys.forEach((k, i) => { if (k && tr.cells[i]) o[k] = T(tr.cells[i].textContent); });
      const raw = String(o.date || "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)), dm = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw); if (dm) { o.time = T(raw.replace(dm[0], "")); o.date = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`; }
      if (o.id) o.id = norm(o.id).replace(/\D/g, "");
      if (o.phone) o.phone = norm(o.phone).replace(/\D/g, "");
      return o;
    });
    return { rows, trs, keys };
  }
  const emptyMsg = () => T(tbl()?.querySelector(".dataTables_empty")?.textContent || "");

  // الصف المطابق للطلب: رقم PSL، وإلا تاريخ الرفع (هجري ±يوم) + نوع الإجازة
  const hNum = s => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? +m[1] * 360 + (+m[2] - 1) * 30 + +m[3] : 0; };
  const typeOk = (row, type) => { const t = norm(row.type || ""); return type === "attendance" ? /مشهد/.test(t) : type === "companion" ? /مرافق/.test(t) : type === "sick" ? !/مشهد|مرافق/.test(t) : true; };
  // المرشحين بالترتيب: نفس PSL، بعدين تاريخ الطلب في صحة من يوم قبل الرفع لـ 7 أيام بعده (الموظف يمكن يدخلها متأخر) — الأقرب أول
  function candidates(rows, item) {
    if (item.psl) { const i = rows.findIndex(r => (r.psl || "").replace(/\s/g, "").toUpperCase() === String(item.psl).replace(/\s/g, "").toUpperCase()); if (i >= 0) return { list: [i], how: "psl" }; }
    if (!item.reqDate) return { list: [], how: "" };
    const want = hNum(item.reqDate);
    const list = rows.map((r, i) => ({ i, d: hNum(r.date) - want, ok: typeOk(r, item.type) })).filter(x => x.ok && x.d >= -1 && x.d <= 7).sort((a, b) => Math.abs(a.d) - Math.abs(b.d)).map(x => x.i);
    return { list, how: "date" };
  }
  // ---------- «عرض» (العين): نقرا تاريخ بداية ونهاية الإجازة ----------
  const DATE_RE = /(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})|(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/;
  const toDmy = m => m[3] ? `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}` : `${m[6].padStart(2, "0")}/${m[5].padStart(2, "0")}/${m[4]}`;
  const FROM_RE = /(تاريخ )?(بدايه|بدء|بداء)( الاجازه)?|من تاريخ|تاريخ الدخول|from ?date|start/i, TO_RE = /(تاريخ )?(نهايه|انتهاء)( الاجازه)?|الي تاريخ|تاريخ الخروج|to ?date|end ?date/i;
  function viewDates(root) {
    // 1) خانات بأسماء معروفة (نموذج العرض غالباً نفس نموذج الإضافة: FromGro / ToGro / CheckInDateGregorean …)
    const byId = ids => { for (const id of ids) { const el = root.querySelector(`#${id}, [name=${id}]`); const v = el && (el.value || el.textContent); const m = v && DATE_RE.exec(norm(v)); if (m) return toDmy(m); } return ""; };
    let from = byId(["FromGro", "FromGregorean", "From", "CheckInDateGregorean", "StartDate"]), to = byId(["ToGro", "ToGregorean", "To", "CheckOutDateGregorean", "EndDate"]);
    // 2) عنوان + تاريخ ميلادي جنبه
    if (!from || !to) {
      const all = [...root.querySelectorAll("label, span, td, th, div, p, b, strong, dt, dd")].filter(el => el.childElementCount <= 1 && T(el.textContent).length < 60);
      const near = re => {
        for (const lab of all.filter(el => re.test(norm(el.textContent)))) {
          let p = lab;
          for (let k = 0; k < 4 && p; k++) {
            const txt = norm(p.textContent || ""); let m = DATE_RE.exec(txt.replace(norm(lab.textContent), "")); if (m) return toDmy(m);
            for (const inp of p.querySelectorAll?.("input") || []) { m = DATE_RE.exec(norm(inp.value || inp.getAttribute("value") || "")); if (m) return toDmy(m); }
            const sib = p.nextElementSibling; if (sib) { m = DATE_RE.exec(norm(sib.textContent || sib.value || "")); if (m) return toDmy(m); const i2 = sib.querySelector?.("input"); if (i2) { m = DATE_RE.exec(norm(i2.value || "")); if (m) return toDmy(m); } }
            p = p.parentElement;
          }
        }
        return "";
      };
      from ||= near(FROM_RE); to ||= near(TO_RE);
    }
    return { from, to };
  }
  const isEye = el => /eye|view|details|عرض/i.test([el.className?.baseVal ?? el.className, el.getAttribute("title"), el.getAttribute("data-original-title"), el.getAttribute("aria-label"), el.getAttribute("href"), el.getAttribute("onclick")].join(" "));
  const BAD = /edit|pencil|print|sync|refresh|delete|trash|pay|تعديل|طباع|حذف|تحديث|دفع|تحقق|اعتماد/i;
  function eyeOf(tr) {
    const cell = tr.cells[tr.cells.length - 1]; if (!cell) return null;
    const cands = [...cell.querySelectorAll("a, button, i, span, img")].filter(el => isEye(el) && !BAD.test([el.className?.baseVal ?? el.className, el.getAttribute("title"), el.getAttribute("onclick"), el.getAttribute("href")].join(" ")));
    const el = cands[0]; if (!el) return null;
    return el.closest("a, button") || el;
  }
  const maskHtml = h => String(h || "").replace(/\s+/g, " ").replace(/\d{5,}/g, m => "9".repeat(m.length)).slice(0, 1500);
  async function readView(tr) {
    const cell = tr.cells[tr.cells.length - 1];
    L("أيقونات الصف: " + maskHtml(cell?.innerHTML));
    const eye = eyeOf(tr);
    if (!eye) { L("⚠ ما لقيت أيقونة «عرض» (العين) — ما ضغطت شي"); return null; }
    const href = eye.tagName === "A" ? eye.getAttribute("href") || "" : "";
    // رابط عادي: نجيبه بالخلفية بدون ما نترك صفحة البحث
    if (href && !/^(#|javascript:)/i.test(href)) {
      L("«عرض» رابط — أقراه بالخلفية");
      const html = await fetch(new URL(href, location.href), { credentials: "include" }).then(r => r.text());
      const doc = new DOMParser().parseFromString(html, "text/html");
      const d = viewDates(doc); if (!d.from) L("صفحة العرض (مختصرة): " + maskHtml(doc.body?.innerHTML).slice(0, 1200));
      return d;
    }
    // زر يفتح نافذة (modal)
    try { sessionStorage.setItem("sabaViewBack", String(Date.now())); } catch {}
    const before = location.href;
    eye.click();
    const root = await waitFor(() => { const m = [...document.querySelectorAll(".modal.in, .modal.show, .modal[style*='block'], [role=dialog]")].find(visible); return m || null; }, 10000);
    if (!root) { L("⚠ ضغطت «عرض» وما طلعت نافذة"); try { sessionStorage.removeItem("sabaViewBack"); } catch {} return null; }
    await waitFor(() => !loading() && DATE_RE.test(norm(root.textContent + [...root.querySelectorAll("input")].map(i => i.value).join(" "))), 8000);
    await sleep(500);
    const d = viewDates(root);
    if (!d.from) L("نافذة العرض (مختصرة): " + maskHtml(root.innerHTML).slice(0, 1200));
    const close = [...root.querySelectorAll("button, a, [data-dismiss]")].find(el => visible(el) && (el.matches("[data-dismiss=modal], [data-bs-dismiss=modal], .close") || /^(اغلاق|إغلاق|الغاء|رجوع|close|×|✕)$/i.test(T(el.textContent))));
    if (close) close.click(); else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
    try { sessionStorage.removeItem("sabaViewBack"); } catch {}
    await sleep(600);
    if (location.href !== before) history.back();
    return d;
  }

  // ---------- كود الصفحة لما يصير خطأ (نخفي بيانات المرضى) ----------
  function snapshot() {
    const root = document.body.cloneNode(true);
    root.querySelectorAll("script, style, link, noscript, svg, img").forEach(e => e.remove());
    root.querySelectorAll("tbody td").forEach(td => { if (td.childElementCount) { td.querySelectorAll("*").forEach(x => { if (!x.childElementCount) x.textContent = mask(x.textContent); }); } else td.textContent = mask(td.textContent); });
    root.querySelectorAll("input").forEach(i => { if (i.type !== "button" && i.type !== "hidden") i.setAttribute("value", i.value ? "[" + i.value.length + " حرف]" : ""); if (i.type === "hidden") i.setAttribute("value", "…"); });
    let html = root.outerHTML.replace(/\s+/g, " ");
    if (html.length > 250000) html = html.slice(0, 250000) + " …(مقصوص)";
    return { url: location.origin + location.pathname, page: "frame", html };
  }
  const mask = s => String(s || "").replace(/\d/g, "9").replace(/[؀-ۿA-Za-z]{2,}/g, w => /حال|معاد|مكتمل|بانتظار|تحقق|تدقيق|معلق|دفع|اجاز|إجاز|مرض|اعتيادي|مواطن|مقيم|مرافق|مشهد|تم|لم|يتم|للمدخل/.test(w) ? w : "اسم");

  // قيم الفلاتر (تواريخ/قوائم) — عشان نعرف لو فيه فلتر مخبّي يقصّ النتائج
  const filters = () => [...document.querySelectorAll("form select, form input:not([type=hidden]):not([type=button])")].filter(e => e.id && e.id !== "IdNumber" && !/name|mobile|phone|جوال/i.test(e.id))
    .map(e => `${e.id}=${e.tagName === "SELECT" ? (e.options[e.selectedIndex]?.text || "").trim().slice(0, 20) : (e.value || "").slice(0, 12)}`).filter(x => !/=$/.test(x)).join(" ");

  async function search(item) {
    LOG = [];
    let r;
    try { r = await search0(item); } catch (e) { r = { err: "خطأ في الكود (الإطار): " + String(e?.message || e) }; L("💥 " + r.err); }
    r.log = LOG.slice(-40);
    const { debug } = await chrome.storage.local.get("debug").catch(() => ({}));
    if (r.err && debug !== false) r.debug = snapshot();
    return r;
  }
  async function search0(item) {
    L(`الإطار: ${location.pathname} · جاهز ${ready()}`);
    if (!ready()) {
      if (!/\/SickLeave\/Index/i.test(location.pathname) && /sickleave\.seha\.sa$/i.test(location.hostname) && !/login|account|error/i.test(location.pathname)) { L("⚠ الإطار مو على صفحة البحث — أرجعه لها"); location.href = location.origin + "/SickLeave/Index"; return { err: "الإطار كان على صفحة ثانية — رجعته لصفحة البحث", retry: true }; }
      const miss = [!idInput() && "خانة الهوية", !searchBtn() && "زر البحث", !tbl() && "جدول النتائج"].filter(Boolean).join("، ");
      L(`⚠ ناقص: ${miss} · نص الصفحة: ${T(document.body?.innerText || "").slice(0, 120)}`);
      return { err: "صفحة البحث ناقصة: " + miss };
    }
    await waitFor(() => !loading(), 15000);
    // المحاولة اللي قبل: البحث حمّل الصفحة من جديد (مو AJAX) → النتيجة قدامنا، نقراها بدون ما نعيد
    let prev = null; try { prev = JSON.parse(sessionStorage.getItem("sabaSearched") || "null"); } catch {}
    if (prev && prev.id === String(item.id) && Date.now() - prev.at < 180e3 && norm(idInput().value).replace(/\D/g, "") === String(item.id)) {
      try { sessionStorage.removeItem("sabaSearched"); } catch {}
      L("البحث اللي قبل حمّل الصفحة — أقرا النتيجة الموجودة");
      return await afterSearch(item);
    }
    // 1) إعادة تعيين (صحة تحفظ آخر هوية)
    let resetNav = 0; try { resetNav = +sessionStorage.getItem("sabaResetAt") || 0; } catch {}
    const rb = resetBtn();
    if (resetNav && Date.now() - resetNav < 180e3) {
      // المرة اللي قبل «إعادة تعيين» حمّلت الصفحة من جديد (وقطعت البحث) → نفضّي الخانات بأيدينا بدالها
      L("«إعادة تعيين» تعيد تحميل الصفحة — أفضّي الخانات بنفسي");
      document.querySelectorAll("form input[type=text], form input:not([type])").forEach(i => { if (i.value) setValue(i, ""); });
      try { sessionStorage.removeItem("sabaResetAt"); } catch {}
    } else if (rb) {
      try { sessionStorage.setItem("sabaResetAt", String(Date.now())); } catch {}
      await clickAndWait(rb, "إعادة تعيين");
      try { sessionStorage.removeItem("sabaResetAt"); } catch {}
    } else L("⚠ ما لقيت زر إعادة تعيين");
    // 2) الهوية
    const inp = idInput();
    setValue(inp, String(item.id));
    try { inp.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "0" })); } catch {}
    await sleep(250);
    if (norm(inp.value).replace(/\D/g, "") !== String(item.id)) { L(`⚠ الخانة فيها ${inp.value.length} حرف بعد الكتابة — أحاول مرة ثانية`); inp.value = String(item.id); inp.dispatchEvent(new Event("change", { bubbles: true })); }
    L(norm(inp.value).replace(/\D/g, "") === String(item.id) ? "كتبت الهوية ✓" : "⚠ ما انكتبت الهوية");
    const f = filters(); if (f) L("الفلاتر: " + f);
    // 3) بحث
    try { sessionStorage.setItem("sabaSearched", JSON.stringify({ id: String(item.id), at: Date.now() })); } catch {}
    await clickAndWait(searchBtn(), "بحث");
    try { sessionStorage.removeItem("sabaSearched"); } catch {}
    return await afterSearch(item);
  }
  async function afterSearch(item) {
    let { rows, trs, keys } = parseTable();
    // تأكد إن النتائج لنفس الهوية (لو الجدول ما تحدّث نعيد مرة)
    if (rows.length && !rows.every(r => !r.id || r.id === String(item.id))) {
      L(`⚠ الجدول فيه هويات ثانية (${rows.length} صف) — أعيد البحث`);
      setValue(idInput(), String(item.id)); await clickAndWait(searchBtn(), "بحث (مرة ثانية)");
      ({ rows, trs, keys } = parseTable());
      if (rows.length && !rows.every(r => !r.id || r.id === String(item.id))) return { err: "البحث ما فلتر بالهوية (الجدول فيه مرضى ثانيين)" };
    }
    L(`النتائج: ${rows.length} صف${rows.length ? "" : ` — «${emptyMsg() || "فاضي"}»`} · الأعمدة: ${keys.filter(Boolean).join(",") || "⚠ ما عرفتها"}`);
    rows = rows.slice(0, 10); trs = trs.slice(0, 10);
    if (rows.length) L("الحالات: " + rows.map(r => `${r.status || "؟"}${r.pay ? "/" + r.pay : ""} ${r.date || ""}`).join(" | "));
    const dmy = x => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(x || ""); return m ? +m[3] * 1e4 + +m[2] * 100 + +m[1] : 0; };
    const same = v => !!v?.from && dmy(v.from) === dmy(item.leaveStart) && (!item.leaveEnd || !v.to || dmy(v.to) === dmy(item.leaveEnd));
    const { list, how } = candidates(rows, item);
    let match = list.length ? list[0] : -1, view = null;
    L(list.length ? `المرشحين (${how === "psl" ? "نفس PSL" : "تاريخ الطلب قريب من الرفع"}): ${list.map(i => i + 1).join("، ")}` : rows.length ? `⚠ ما فيه صف بتاريخ طلب قريب من ${item.reqDate || "—"}` : "ما فيه إجازات بهالهوية");
    let skip = false; try { skip = sessionStorage.getItem("sabaViewSkip") === String(item.id); } catch {}
    if (item.leaveStart && rows.length && skip) L("تخطيت «عرض» (المحاولة اللي قبل فتحت صفحة ثانية)");
    else if (item.leaveStart && rows.length) {
      // نتأكد بتاريخ الإجازة من «عرض»: المرشحين، ولو ما فيه مرشح نشيك أحدث صفين (يمكن انرفعت بصحة بعد فترة)
      const toCheck = (list.length ? list : rows.map((r, i) => i).sort((a, b) => hNum(rows[b].date) - hNum(rows[a].date))).slice(0, 3);
      try { sessionStorage.setItem("sabaViewSkip", String(item.id)); } catch {}
      for (const i of toCheck) {
        let v = null;
        try { v = await readView(trs[i]); } catch (e) { L("⚠ «عرض»: " + (e?.message || e)); }
        L(v?.from ? `صف ${i + 1}: تاريخ الإجازة ${v.from} ← ${v.to || "؟"}${same(v) ? " ✓ نفس اللي عندنا" : ""}` : `⚠ صف ${i + 1}: ما قدرت أقرا تاريخ الإجازة من «عرض»`);
        if (!v?.from) break;                                                         // العرض ما يشتغل — لا نكرر
        if (same(v)) { match = i; view = v; break; }
        if (i === match) view = v;                                                   // أقرب مرشح بتاريخ مختلف → البوت يبلّغك بالفرق
      }
      try { sessionStorage.removeItem("sabaViewSkip"); } catch {}
    }
    if (match >= 0) L(`الصف المطابق: ${match + 1} (${rows[match].status || "؟"})`);
    return { rows, match: match >= 0 ? match : null, view };
  }

  async function keepAlive() {
    if (!ready()) return { ok: false, ...state() };
    if (!loading()) searchBtn().click();
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (!/^F_/.test(m?.type || "")) return false;                                   // رسائل الصفحة الأم مو لنا
    (async () => {
      if (m.type === "F_STATE") return state();
      if (m.type === "F_SEARCH") return search(m.item);
      if (m.type === "F_KEEPALIVE") return keepAlive();
      return { err: "?" };
    })().then(reply, e => reply({ err: String(e?.message || e) }));
    return true;
  });
})();
