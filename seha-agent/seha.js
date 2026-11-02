// صفحات منصة صحة (التبويب المثبّت حق الأداة): نعرف وين حنا، ندخل بنفاذ، نختار الحساب، نبحث بالهوية.
// ⚠ ما نضغط أبداً: إضافة، تحقق، حفظ، تعديل (القلم)، طباعة — بس: دخول نفاذ، اختيار الحساب، القائمة، «بحث»، «إعادة تعيين»، «عرض» (العين).
(() => {
  if (window.top !== window) return;
  const { norm, T, visible, ownText, sleep, waitFor, textEls, realClick, hover, setValue, inputByLabel } = A;
  const bodyN = () => norm(document.body?.innerText || "");

  function page() {
    const h = location.hash || "", t = bodyN();
    if (/حسابات صحه طبي/.test(t)) return "accounts";                               // رابطها #/account/login?sessionId=… (مو صفحة دخول)
    if (/sessionId=/i.test(h)) return "loading";                                    // راجع من نفاذ — يحمّل
    if (/iamredirection/i.test(h)) return "redirect";
    if (/Account\/Login/i.test(h) && /تسجيل الدخول باستخدام/.test(t)) return "login";
    if (/Account\/Login/i.test(h)) return "loading";
    if (/بحث عن اجازه مرضيه/.test(t) && inputByLabel(/رقم هويه/)) return "search";
    if ((/مرحبا بك/.test(t) || /الصفحه الرييسيه/.test(t)) && textEls("الخدمات").some(visible)) return "dashboard";
    if (/تسجيل الدخول باستخدام/.test(t)) return "login";
    if (/انشاء حساب/.test(t) && /تسجيل دخول/.test(t) && !/مرحبا بك/.test(t)) return "login";   // الصفحة العامة (طلّعته)
    if (!t || t.length < 40) return "loading";
    return "unknown";
  }
  // الحساب الحالي (اسم المنشأة فوق)
  function account() {
    return [...document.querySelectorAll("body *")]
      .filter(el => el.childElementCount === 0)
      .map(el => ({ el, r: el.getBoundingClientRect(), t: T(el.textContent) }))
      .filter(x => x.r.top >= 0 && x.r.top < 110 && x.t.length < 120 && /مجمع|شركة|عيادات/.test(x.t) && !/منشأة/.test(x.t))
      .map(x => x.t).join(" | ");
  }

  async function clickNafath() {
    if (!/Account\/Login/i.test(location.hash) && !/تسجيل الدخول باستخدام/.test(bodyN())) { location.hash = "#/Account/Login"; await sleep(2500); }
    const find = () => [...document.querySelectorAll("button, a")].find(el => visible(el) && /تسجيل الدخول باستخدام/.test(norm(el.textContent)));
    // نضغط ونتأكد إنه انتقل (صفحة «ستغادر هذا الموقع» أو نفاذ) — ما انتقل؟ نضغط مرة ثانية (لين 6 مرات)
    for (let i = 0; i < 6; i++) {
      const b = await waitFor(find, 10000);
      if (!b) return { ok: !/Account\/Login/i.test(location.hash) };
      realClick(b);
      const moved = await waitFor(() => !/Account\/Login/i.test(location.hash) || /ستغادر|بوابه نفاذ/.test(bodyN()), 5000);
      if (moved) return { ok: true };
    }
    return { ok: false };
  }
  // رابط صفحة الدخول (#/Account/Login) وأنت فاتحها قدامك → نضغط «تسجيل الدخول باستخدام نفاذ» لحالنا (تبويب الأداة المخفي تتحكم فيه الخلفية)
  let autoBusy = false, autoAt = 0;
  setInterval(async () => {
    if (autoBusy || page() !== "login" || document.visibilityState !== "visible") return;
    if (Date.now() - autoAt < 15000) return;
    const c = await chrome.storage.local.get(["natId", "enabled"]).catch(() => ({}));
    if (c.enabled === false || !c.natId) return;
    autoBusy = true; autoAt = Date.now();
    try { await clickNafath(); } finally { autoBusy = false; }
  }, 2000);
  // صفحة «حسابات صحة طبي» بعد دخول نفاذ سوّته الأداة (آخر 10 دقايق) → نختار حساب البوادي (مدخل الإجازات) لحالنا
  let pickAt = 0;
  setInterval(async () => {
    if (page() !== "accounts" || Date.now() - pickAt < 8000) return;
    const c = await chrome.storage.local.get(["enabled", "nafathAt", "pickAcc"]).catch(() => ({}));
    if (c.enabled === false || !c.nafathAt || Date.now() - c.nafathAt > 10 * 60e3) return;
    pickAt = Date.now();
    await pickAccount(c.pickAcc || { group: "سابا الطبية", role: "مدخل الإجازات المرضية", key: "البوادي" });
  }, 2500);
  // صفحة «أنت الآن ستغادر هذا الموقع» تتحول لحالها خلال ثواني — لو علقت نضغط الزر
  setInterval(() => {
    if (!/iamredirection/i.test(location.hash)) return;
    const b = [...document.querySelectorAll("button, a")].find(el => visible(el) && /الانتقال الي بوابه نفاذ/.test(norm(el.textContent)));
    if (b && Date.now() - (+b.dataset.sabaClicked || 0) > 6000 && performance.now() > 6000) { b.dataset.sabaClicked = String(Date.now()); realClick(b); }   // ما تحوّل لحاله؟ نضغط (ونعيد كل 6 ثواني)
  }, 2000);

  // صفحة «حسابات صحة طبي»: نفتح المجموعة ونختار «مدخل الإجازات المرضية — الفرع»
  const leaves = () => [...document.querySelectorAll("body *")].filter(el => el.childElementCount === 0 && visible(el));
  function accItem(acc) {
    const key = norm(acc.key), role = norm(acc.role);
    return leaves().find(el => { const t = norm(el.textContent); return t.includes(role) && t.includes(key) && !t.includes("مدقق"); }) || null;
  }
  async function pickAccount(acc) {
    let item = accItem(acc);
    if (!item) {
      const head = leaves().find(el => norm(el.textContent) === norm(acc.group));
      if (!head) return { ok: false, err: "ما لقيت مجموعة " + acc.group };
      realClick(head);
      item = await waitFor(() => accItem(acc), 5000);
    }
    if (!item) return { ok: false, err: "ما لقيت حساب " + acc.role + " — " + acc.key };
    realClick(item); return { ok: true };
  }
  // تبديل الحساب من داخل صحة (قائمة المنشآت فوق — نفس أداة الموظفين)
  function menuItems() {
    return [...document.querySelectorAll("body *")].filter(el => visible(el) && /^منشا(ه|ة)/.test(norm(ownText(el))))
      .map(el => { const box = el.closest("a, li, button, [role=menuitem], .dropdown-item") || el.parentElement?.parentElement || el; return { el, box, t: norm(box.textContent) }; });
  }
  async function switchAccount(acc) {
    const key = norm(acc.key), role = norm(acc.role);
    const find = () => { const its = menuItems().filter(x => x.t.includes(key)); return its.find(x => x.t.includes(role) && !x.t.includes("مدقق")) || its.find(x => /اجازات المرضيه/.test(x.t) && /مدخل/.test(x.t)) || null; };
    let it = find();
    if (!it) {
      const head = [...document.querySelectorAll("body *")].filter(el => el.childElementCount === 0 && visible(el))
        .find(el => { const r = el.getBoundingClientRect(); const t = T(el.textContent); return r.top >= 0 && r.top < 110 && /مجمع|شركة|عيادات/.test(t) && !/منشأة/.test(t); });
      if (!head) return { ok: false, err: "ما لقيت اسم المنشأة فوق" };
      realClick(head);
      it = await waitFor(find, 4000);
    }
    if (!it) return { ok: false, err: `ما لقيت حساب «${acc.key}» في قائمة المنشآت` };
    try { it.box.scrollIntoView({ block: "nearest" }); } catch {}
    await sleep(150); realClick(it.el);
    return { ok: true, switching: true };
  }

  // الخدمات ← الإجازات المرضية (صفحة البحث)
  async function gotoSearch() {
    if (page() === "search") return true;
    let link = textEls("الإجازات المرضية").find(visible);
    if (!link) {
      const svc = await waitFor(() => textEls("الخدمات").find(visible), 6000); if (!svc) return false;
      hover(svc); link = await waitFor(() => textEls("الإجازات المرضية").find(visible), 1500);
      if (!link) { realClick(svc); hover(svc); link = await waitFor(() => textEls("الإجازات المرضية").find(visible), 2500); }
      if (!link) link = textEls("الإجازات المرضية")[0] || null;
    }
    if (!link) return false;
    hover(link); realClick(link);
    return !!(await waitFor(() => page() === "search", 15000));
  }

  // جدول النتائج
  const COLS = [[/اسم المريض/, "name"], [/نوع الهويه/, "idType"], [/رقم الهويه|الاقامه/, "id"], [/جوال/, "phone"], [/رمز الخدمه/, "psl"], [/حاله ?الطلب/, "status"], [/تاريخ الطلب/, "date"], [/حاله ?الدفع/, "pay"], [/نوع الاجازه/, "type"]];
  function table() { return [...document.querySelectorAll("table")].find(t => visible(t) && /رمز الخدمه/.test(norm(t.innerText))) || null; }
  function parseTable() {
    const t = table(); if (!t) return { rows: [], trs: [] };
    const ths = [...(t.querySelector("thead") || t).querySelectorAll("th")];
    const keys = ths.map(th => (COLS.find(([re]) => re.test(norm(th.innerText || th.textContent))) || [, ""])[1]);
    const trs = [...t.querySelectorAll("tbody tr")].filter(tr => tr.querySelectorAll("td").length >= 4);
    const rows = trs.map(tr => {
      const tds = [...tr.querySelectorAll("td")], o = {};
      keys.forEach((k, i) => { if (k && tds[i]) o[k] = T(tds[i].innerText); });
      const dm = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(A.norm(o.date || "")); if (dm) { o.time = T((o.date || "").replace(dm[0], "")); o.date = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`; }
      if (o.id) o.id = o.id.replace(/\D/g, "");
      return o;
    });
    return { rows, trs };
  }
  const noData = () => { const t = table(); return !!t && /لا توجد|لا يوجد|no data|no records/i.test(norm(t.innerText)) && !parseTable().rows.length; };

  // الصف المطابق للطلب: رقم PSL، وإلا تاريخ الرفع (هجري ±يوم) + نوع الطلب
  const hNum = s => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? +m[1] * 360 + (+m[2] - 1) * 30 + +m[3] : 0; };
  const typeOk = (row, type) => { const t = norm(row.type || ""); return type === "attendance" ? /مشهد/.test(t) : type === "companion" ? /مرافق/.test(t) : type === "sick" ? !/مشهد|مرافق/.test(t) : true; };
  function matchRow(rows, item) {
    if (item.psl) { const i = rows.findIndex(r => (r.psl || "").replace(/\s/g, "") === item.psl); if (i >= 0) return i; }
    if (item.reqDate) {
      const want = hNum(item.reqDate);
      const c = rows.map((r, i) => ({ i, d: Math.abs(hNum(r.date) - want), ok: typeOk(r, item.type) })).filter(x => x.d <= 1 && x.ok).sort((a, b) => a.d - b.d);
      if (c.length) return c[0].i;
    }
    return -1;
  }

  // «عرض» (العين) للصف → نقرا تاريخ بداية ونهاية الإجازة، ونسكّر
  const DATE_RE = /(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})|(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})/;
  const toDmy = m => m[3] ? `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}` : `${m[6].padStart(2, "0")}/${m[5].padStart(2, "0")}/${m[4]}`;
  function viewDates(root) {
    const all = [...root.querySelectorAll("*")].filter(el => el.childElementCount === 0 && visible(el));
    const near = re => {
      const lab = all.find(el => re.test(norm(el.textContent)) && norm(el.textContent).length < 50); if (!lab) return "";
      let p = lab;
      for (let k = 0; k < 4 && p; k++) { p = p.parentElement; const txt = A.norm(p?.innerText || "").replace(norm(lab.textContent), ""); const m = DATE_RE.exec(txt); if (m) return toDmy(m); const inp = p?.querySelector("input"); if (inp) { const mm = DATE_RE.exec(A.norm(inp.value)); if (mm) return toDmy(mm); } }
      return "";
    };
    return { from: near(/(بدايه|بداء|من تاريخ).*(اجازه|ميلادي)|تاريخ بدايه|تاريخ البدايه|بدايه الاجازه/), to: near(/(نهايه|الي تاريخ|إلى تاريخ).*(اجازه|ميلادي)|تاريخ نهايه|تاريخ النهايه|نهايه الاجازه/) };
  }
  async function readView(tr) {
    const eye = tr.querySelector('[class*="eye"], [title*="عرض"], [aria-label*="عرض"], [ngbtooltip*="عرض"], [mattooltip*="عرض"]');
    if (!eye) return null;                                                          // ما نضغط أي أيقونة ثانية (قلم/طباعة)
    const before = location.hash;
    realClick(eye);
    const root = await waitFor(() => { const m = document.querySelector(".modal.show, [role=dialog], mat-dialog-container, .p-dialog, .modal-dialog"); if (m && visible(m)) return m; return location.hash !== before ? document.body : null; }, 8000);
    if (!root) return null;
    await sleep(1200);
    const d = viewDates(root);
    // نسكّر: زر إغلاق/رجوع، أو Escape، أو نرجع للصفحة
    const close = [...root.querySelectorAll("button, a, [aria-label]")].find(el => visible(el) && (/^(اغلاق|الغاء|رجوع|عوده|close|×|✕)$/i.test(norm(el.textContent)) || /close|اغلاق/i.test(el.getAttribute("aria-label") || "")));
    if (close) realClick(close); else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(800);
    if (location.hash !== before && page() !== "search") { history.back(); await waitFor(() => page() === "search", 8000); }
    return d;
  }

  async function search(item) {
    // الحساب الصحيح أول
    const cur = norm(account());
    if (item.acc && cur && !cur.includes(norm(item.acc.key))) { const r = await switchAccount(item.acc); return r.ok ? { switching: true } : { err: r.err }; }
    if (!(await gotoSearch())) return { err: "ما قدرت أفتح صفحة الإجازات المرضية" };
    const reset = textEls("إعادة تعيين").find(visible); if (reset) { realClick(reset); await sleep(700); }
    const inp = inputByLabel(/رقم هويه/); if (!inp) return { err: "ما لقيت خانة رقم الهوية" };
    setValue(inp, item.id); await sleep(300);
    const btn = textEls("بحث").find(el => visible(el) && /^(BUTTON|A|INPUT)$/.test(A.clickable(el).tagName)); if (!btn) return { err: "ما لقيت زر البحث" };
    const sig = table()?.innerText || "";
    realClick(btn);
    await waitFor(() => { const { rows } = parseTable(); return noData() || (rows.length && rows.some(r => r.id === item.id) && (table()?.innerText || "") !== sig) || (rows.length && rows.every(r => r.id === item.id)); }, 15000);
    await sleep(700);
    let { rows, trs } = parseTable();
    rows = rows.slice(0, 10);
    const match = matchRow(rows, item);
    let view = null;
    if (match >= 0 && trs[match] && item.leaveStart) { try { view = await readView(trs[match]); } catch {} }
    return { rows, match: match >= 0 ? match : null, view, account: account() };
  }

  async function keepAlive() {
    if (page() !== "search" && !(await gotoSearch())) return { ok: false };
    const btn = textEls("بحث").find(el => visible(el) && /^(BUTTON|A|INPUT)$/.test(A.clickable(el).tagName));
    if (btn) realClick(btn);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    (async () => {
      if (m.type === "STATE") return { page: page(), account: account() };
      if (m.type === "CLICK_NAFATH") return clickNafath();
      if (m.type === "PICK") return pickAccount(m.acc);
      if (m.type === "SEARCH") return search(m.item);
      if (m.type === "KEEPALIVE") return keepAlive();
      if (m.type === "GOTO_SEARCH") return { ok: await gotoSearch() };
      return null;
    })().then(reply, e => reply({ err: String(e?.message || e) }));
    return true;
  });
})();
