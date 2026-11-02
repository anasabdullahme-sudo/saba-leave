// صفحات منصة صحة (التبويب المثبّت حق الأداة): نعرف وين حنا، ندخل بنفاذ، نختار الحساب، نبحث بالهوية.
// ⚠ ما نضغط أبداً: إضافة، تحقق، حفظ، تعديل (القلم)، طباعة — بس: دخول نفاذ، اختيار الحساب، القائمة، «بحث»، «إعادة تعيين»، «عرض» (العين).
(() => {
  if (window.top !== window || window.__sabaTop) return; window.__sabaTop = true;
  const { norm, T, visible, ownText, sleep, waitFor, textEls, realClick, hover, setValue, inputByLabel } = A;
  const bodyN = () => norm(document.body?.innerText || "");
  // شريط حالة صغير فوق (عشان تشوف وش تسوي الأداة)
  let bar = null, barT = 0;
  const show = (t, keep) => {
    if (!bar || !bar.isConnected) { bar = document.createElement("div"); bar.style.cssText = "position:fixed;top:8px;left:8px;z-index:2147483647;background:#003765;color:#fff;font:600 13px Tahoma,sans-serif;padding:6px 12px;border-radius:8px;direction:rtl;box-shadow:0 4px 14px rgba(0,0,0,.3);max-width:60vw"; document.documentElement.append(bar); }
    bar.textContent = "أداة صحة: " + t; bar.style.display = ""; clearTimeout(barT); if (!keep) barT = setTimeout(() => { if (bar) bar.style.display = "none"; }, 15000);
  };

  const frameEl = () => [...document.querySelectorAll("iframe")].find(f => /sickleave\.seha\.sa/i.test(f.src || "") && visible(f)) || null;
  function page() {
    const h = location.hash || "", t = bodyN();
    if (/حسابات صحه طبي/.test(t)) return "accounts";                               // رابطها #/account/login?sessionId=… (مو صفحة دخول)
    if (/sessionId=/i.test(h)) return "loading";                                    // راجع من نفاذ — يحمّل
    if (/iamredirection/i.test(h)) return "redirect";
    if (/Account\/Login/i.test(h) && /تسجيل الدخول باستخدام/.test(t)) return "login";
    if (/Account\/Login/i.test(h)) return "loading";
    if (frameEl()) return "search";                                                  // صفحة الإجازات: محتواها داخل إطار من sickleave.seha.sa (frame.js يشتغل هناك)
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

  // ---------- وضع التشخيص: نسجّل كل خطوة ----------
  let LOG = [];
  const L = t => { LOG.push(new Date().toLocaleTimeString("en-GB", { hour12: false }) + " " + t); };
  function snapshot() {
    const root = document.body.cloneNode(true);
    root.querySelectorAll("script, style, link, noscript, svg, img").forEach(e => e.remove());
    root.querySelectorAll("input").forEach(i => { i.setAttribute("value", i.value ? "[" + i.value.length + " حرف]" : ""); });
    let html = root.outerHTML.replace(/\s+/g, " ").replace(/\d{6,}/g, m => "9".repeat(m.length));
    if (html.length > 150000) html = html.slice(0, 150000) + " …(مقصوص)";
    return { url: location.href.replace(/sessionId=[^&]+/, "sessionId=…"), page: page(), account: account(), html };
  }
  // تجهيز البحث في الصفحة الأم: الحساب الصح + فتح صفحة الإجازات (البحث نفسه في frame.js)
  async function prep(item) {
    LOG = [];
    let r;
    try { r = await prep0(item); } catch (e) { r = { err: "خطأ في الكود: " + String(e?.message || e) }; L("💥 " + r.err); }
    if (r.err) show("⚠ " + r.err); else if (r.switching) show("أبدّل الحساب…"); else show(`أبحث عن ${String(item.id).slice(0, 3)}••••${String(item.id).slice(-3)}…`);
    r.log = LOG.slice(-20);
    const { debug } = await chrome.storage.local.get("debug").catch(() => ({}));
    if (r.err && debug !== false) r.debug = snapshot();
    return r;
  }
  async function prep0(item) {
    L(`بدأت: حساب مطلوب «${item.acc?.key}» · الصفحة «${page()}» · ${location.hash.slice(0, 40)}`);
    const cur = norm(account());
    L(`الحساب الحالي: «${account() || "ما لقيته فوق"}»`);
    if (item.acc && cur && !cur.includes(norm(item.acc.key))) {
      const r = await switchAccount(item.acc);
      L(r.ok ? "ضغطت تبديل الحساب" : "⚠ تبديل الحساب: " + r.err);
      return r.ok ? { switching: true } : { err: r.err };
    }
    const okNav = await gotoSearch();
    L(okNav ? `صفحة الإجازات مفتوحة (الإطار: ${frameEl()?.src.replace(/\?.*/, "") || "؟"})` : `⚠ ما قدرت أفتح صفحة الإجازات — الصفحة «${page()}»، «الخدمات» موجودة: ${textEls("الخدمات").some(visible)}، «الإجازات المرضية»: ${textEls("الإجازات المرضية").length}، إطارات: ${[...document.querySelectorAll("iframe")].map(f => (f.src || "").replace(/\?.*/, "")).join(" ") || "ولا واحد"}`);
    if (!okNav) return { err: "ما قدرت أفتح صفحة الإجازات المرضية" };
    return { ok: true };
  }
  async function keepAlive() { return { ok: page() === "search" || await gotoSearch() }; }

  const MINE = new Set(["STATE", "CLICK_NAFATH", "PICK", "PREP", "KEEPALIVE", "GOTO_SEARCH", "RELOAD_FRAME"]);
  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (!MINE.has(m?.type)) return false;                                         // رسائل الإطار (F_…) مو لنا — نخليه هو يرد
    (async () => {
      if (m.type === "STATE") return { page: page(), account: account() };
      if (m.type === "CLICK_NAFATH") return clickNafath();
      if (m.type === "PICK") return pickAccount(m.acc);
      if (m.type === "PREP") return prep(m.item);
      if (m.type === "RELOAD_FRAME") { const f = frameEl(); if (f) { f.src = f.src; return { ok: true }; } return { ok: false }; }
      if (m.type === "KEEPALIVE") return keepAlive();
      if (m.type === "GOTO_SEARCH") return { ok: await gotoSearch() };
      return { err: "?" };
    })().then(reply, e => reply({ err: String(e?.message || e) }));
    return true;
  });
})();
