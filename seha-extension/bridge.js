// جسر بين لوحة الموظف (سابا) والإضافة — يشتغل فقط على صفحة اللوحة
(() => {
  const isBoard = () => /لوحة الإجازات|لوحة رفع الإجازات/.test(document.title) || !!document.querySelector("#sehaDrawer");
  const post = msg => window.postMessage(msg, location.origin);
  // بعد تحديث/إعادة تحميل الإضافة تبقى النسخة القديمة في الصفحة بدون اتصال — نوقفها بهدوء بدل الأخطاء
  const ac = new AbortController(), on = { signal: ac.signal };
  let timer = 0;
  const alive = () => { try { if (chrome.runtime?.id) return true; } catch {} ac.abort(); clearInterval(timer); return false; };
  const listen = fn => window.addEventListener("message", e => { if (!alive()) return; try { const r = fn(e); r?.catch?.(() => {}); } catch { alive(); } }, on);

  // كل «تم الرفع» ما تأكد للحين (sabaDone_<وقت>، وsabaDone القديمة) → نرسله للوحة؛ اللوحة تحفظ وترد ACK ونمسحه
  function forwardDone() {
    if (!alive()) return;
    chrome.storage.local.get(null, all => {
      const items = Object.entries(all).filter(([k]) => k.startsWith("sabaDone_")).map(([, v]) => v).filter(v => v && v.at);
      if (all.sabaDone?.at && !items.some(v => v.at === all.sabaDone.at)) items.push(all.sabaDone);
      const old = Object.keys(all).filter(k => k.startsWith("sabaDone_") && Date.now() - (all[k]?.at || 0) > 3 * 864e5);
      if (old.length) chrome.storage.local.remove(old);                              // أقدم من 3 أيام → نتركه
      for (const d of items.sort((a, b) => a.at - b.at)) if (Date.now() - d.at < 3 * 864e5) post({ type: "SABA_SEHA_DONE", id: d.id, ref: d.ref, psl: d.psl || "", at: d.at });
    });
  }
  function announce() {
    if (!isBoard() || !alive()) return;
    post({ type: "SABA_EXT_READY", version: chrome.runtime.getManifest().version });
    forwardDone(); // لو فيه "تم" وصل واللوحة كانت مقفلة
  }

  listen(e => {
    if (e.source !== window || !e.data || typeof e.data !== "object") return;
    const m = e.data;
    if (m.type === "SABA_EXT_PING") announce();
    if (m.type === "SABA_SEHA_FILL" && m.payload) {
      chrome.storage.local.set({ sabaReq: m.payload, sabaNavFor: "", sabaAddFor: "", sabaSwFor: "" }, () => post({ type: "SABA_SEHA_FILL_ACK", ref: m.payload.ref }));
    }
    if (m.type === "SABA_CHECK_RES" && m.at) chrome.storage.local.set({ sabaCheckRes: { at: m.at, id: m.id, status: m.status, by: m.by || "", doneAt: m.doneAt || 0 } });
    if (m.type === "SABA_QUEUE" && Array.isArray(m.items)) chrome.storage.local.set({ sabaQueue: { at: Date.now(), items: m.items.slice(0, 200) } });
    // اللوحة تقول: هذا الطلب انرفع من قبل → الأداة في صحة تنبّه الموظف
    if (m.type === "SABA_SEHA_DONE_DUP" && m.id) chrome.storage.local.set({ sabaDup: { id: m.id, ref: m.ref || "", by: m.by || "", doneAt: m.doneAt || 0, name: m.name || "", at: Date.now() } });
    if (m.type === "SABA_SEHA_DONE_ACK") {
      chrome.storage.local.remove("sabaDone_" + m.at);
      chrome.storage.local.get("sabaDone", ({ sabaDone }) => { if (sabaDone && sabaDone.at === m.at) chrome.storage.local.remove("sabaDone"); });
    }
  });

  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && Object.keys(ch).some(k => (k === "sabaDone" || k.startsWith("sabaDone_")) && ch[k].newValue)) forwardDone(); });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.sabaWantQueue?.newValue && isBoard() && alive()) post({ type: "SABA_QUEUE_REQ" }); });   // الأداة تطلب قائمة جديدة
  chrome.storage.onChanged.addListener((ch, area) => { const c = area === "local" && ch.sabaCheck?.newValue; if (c && isBoard() && alive()) post({ type: "SABA_CHECK", id: c.id, at: c.at }); });   // الأداة تسأل: انرفع؟
  // صفحة موظفين قديمة (قبل التحديث التلقائي) → نحدّثها لحالها لما تكون فاضية (ما فيه طلب مفتوح ولا كتابة) — مرة كل 10 دقايق بالكثير
  setTimeout(function oldBoard() {
    if (!alive() || !isBoard() || +(document.documentElement.dataset.sabaBoard || 0) >= 4) return;   // 4 = فيها قفل المراجع
    const a = document.activeElement, busy = document.querySelector("#drawer.on, .modal:not([hidden])") || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value);
    if (busy) return setTimeout(oldBoard, 15000);
    try { if (Date.now() - (+sessionStorage.getItem("sabaOldReload") || 0) < 10 * 60000) return; sessionStorage.setItem("sabaOldReload", String(Date.now())); } catch { return; }
    location.reload();
  }, 8000);
  // الطلب المفتوح في صحة بهالجهاز → اللوحة تحجزه («مفتوح عند فلان» عند الباقين)
  // (1.9.2) نرسل معه آخر حركة في صحة — اللوحة ترجّع القفل بس لو فيه حركة آخر 5 دقايق
  const active = () => alive() && chrome.storage.local.get(["sabaReq", "sabaAct"], ({ sabaReq: r, sabaAct: a }) => { if (r?.id && isBoard() && Date.now() - (r.sentAt || 0) < 60 * 60000) post({ type: "SABA_ACTIVE", id: r.id, act: Math.max(a?.id === r.id ? a.at || 0 : 0, r.sentAt || 0) }); });
  // (1.9.2) اللوحة رفعت طلب (من الأداة أو من اللوحة) → نسجّله: الأداة ما تعرضه مرة ثانية إلا لو رجع للانتظار فعلاً
  listen(e => {
    if (e.source !== window || e.data?.type !== "SABA_DONE_MARK" || !e.data.id || !isBoard()) return;
    const { id, n } = e.data;
    chrome.storage.local.get("sabaDoneLog", ({ sabaDoneLog: L = {} }) => {
      const now = Date.now(), next = Object.fromEntries(Object.entries(L).filter(([, v]) => now - (v?.at || 0) < 3 * 864e5));
      if (next[id] && next[id].n >= (n || 0)) return;
      next[id] = { at: now, n: n || 0 }; chrome.storage.local.set({ sabaDoneLog: next });
    });
  });
  // الأداة طلبت طلب واللوحة تأخرت بالرد (الأداة استسلمت) → نفك القفل اللي ممكن انحجز
  chrome.storage.onChanged.addListener((ch, area) => { const u = area === "local" && ch.sabaUnlock?.newValue; if (u?.id && isBoard() && alive()) post({ type: "SABA_RELEASE", id: u.id }); });
  // الموظف يكتب/يضغط في صحة → اللوحة تجدد القفل (الأداة ترسلها كل 20 ثانية بالكثير)
  chrome.storage.onChanged.addListener((ch, area) => { const a = area === "local" && ch.sabaAct?.newValue; if (a?.id && isBoard() && alive()) post({ type: "SABA_ACT", id: a.id, at: a.at }); });
  // اللوحة: القفل راح (انتهى وقتك / أخذه جهاز ثاني) أو رجع لك → الأداة في صحة تبيّنه
  listen(e => { if (e.source !== window || e.data?.type !== "SABA_LOCK" || !e.data.id || !isBoard()) return; const { id, ok, reason, by } = e.data; chrome.storage.local.set({ sabaLock: { id, ok: !!ok, reason: reason || "", by: by || "", at: Date.now() } }); });
  // تبويب اللوحة ما ينام ولا ينمسح من الذاكرة (هو اللي يوصل الأداة بقاعدة البيانات)
  // كل صفحات سابا (اللوحة والرئيسية والأطباء) تتشارك اتصال قاعدة البيانات بالمتصفح — لو وحدة منها نامت ممكن تأخّر الباقين
  const ourPage = location.hostname === "anasabdullahme-sudo.github.io" && location.pathname.startsWith("/saba-leave/");
  const keepAwake = () => { if ((isBoard() || ourPage) && alive()) try { chrome.runtime.sendMessage({ type: "SABA_BOARD_HERE" }); } catch {} };
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || !ch.sabaReq || !isBoard()) return;
    const o = ch.sabaReq.oldValue, n = ch.sabaReq.newValue;
    // الطلب انقفل في الأداة: لو بسبب «تم الرفع» لا نفك القفل (يبقى لين ينحفظ «تم الرفع» — وإلا جهاز ثاني يلحق ياخذه بهالثانية)
    if (o?.id && o.id !== n?.id) chrome.storage.local.get(null, all => { if (!Object.entries(all).some(([k, v]) => k.startsWith("sabaDone_") && v?.id === o.id)) post({ type: "SABA_RELEASE", id: o.id }); });
    if (n?.id) active();
  });
  timer = setInterval(() => { try { active(); } catch { alive(); } }, 120000);
  chrome.storage.onChanged.addListener((ch, area) => { const a = area === "local" && ch.sabaAlert?.newValue; if (a && isBoard()) post({ type: "SABA_SEHA_ALERT", labels: a.labels || [], at: a.at }); });

  // طلب تعديل من داخل صحة → لوحة سابا (تبويب واحد بس يتكفّل فيه)
  const TAB = Math.random().toString(36).slice(2);
  chrome.storage.onChanged.addListener(async (ch, area) => {
    const fr = area === "local" && ch.sabaFixReq?.newValue; if (!fr || !isBoard()) return;
    const { sabaFixClaim: c } = await chrome.storage.local.get("sabaFixClaim");
    if (c && c.at === fr.at) return;                                   // تبويب ثاني أخذه
    await chrome.storage.local.set({ sabaFixClaim: { at: fr.at, tab: TAB } });
    await new Promise(r => setTimeout(r, 120));
    const { sabaFixClaim: c2 } = await chrome.storage.local.get("sabaFixClaim");
    if (c2?.tab !== TAB) return;
    post({ type: "SABA_FIX_REQ", ...fr });
  });
  listen(e => {
    if (e.source !== window || e.data?.type !== "SABA_FIX_RES") return;
    const { type, ...res } = e.data;
    chrome.storage.local.set({ sabaFixRes: res }); chrome.storage.local.remove("sabaFixReq");
  });

  // تنبيه طبيب من قروب الاستقبال → كل تبويبات كروم (alert.js يعرضه في الصفحة اللي قدامك)
  listen(async e => {
    if (e.source !== window || e.data?.type !== "SABA_DOC_ALERT" || !e.data.ev?.id) return;
    const ev = e.data.ev;
    try {
      // كل تبويب يمرّر التنبيه، والتكرار ينشال في alert.js (حسب رقم التنبيه) — ما نخسر تنبيه لو وصلت مع بعض
      const { sabaDocSeen: seen = [] } = await chrome.storage.local.get("sabaDocSeen");
      if (seen.includes(ev.id)) return;
      await chrome.storage.local.set({ sabaDocAlert: { ...ev, shownAt: Date.now(), via: TAB }, sabaDocSeen: [...seen, ev.id].slice(-150) });
    } catch { /* الإضافة تحدّثت — الصفحة تحتاج تحديث */ }
  });

  // صورة التقرير للطلب المفتوح في صحة (اللوحة ترسلها لما يصير الطلب نشط) — نسخة وحدة بس، وتنمسح لما يتغير الطلب
  listen(async e => {
    if (e.source !== window || e.data?.type !== "SABA_REQ_IMG" || !e.data.id || typeof e.data.url !== "string" || !isBoard()) return;
    const { sabaReq: r, sabaReqImg: cur } = await chrome.storage.local.get(["sabaReq", "sabaReqImg"]);
    if (r?.id !== e.data.id || (cur?.id === e.data.id && cur.url === e.data.url)) return;
    if (e.data.url.length > 6e6) return;                                  // صورة كبيرة جداً — تنفتح من اللوحة
    await chrome.storage.local.set({ sabaReqImg: { id: e.data.id, url: e.data.url, pdf: !!e.data.pdf, at: Date.now() } });
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || !ch.sabaReq || !alive()) return;
    if (!ch.sabaReq.newValue) chrome.storage.local.remove("sabaReqImg");   // انقفل الطلب/انرفع → نمسح الصورة من الجهاز
  });

  // صفحة «ربط جهاز الطبيب» في موقعنا بس → نحفظ مين الطبيب على هالجهاز (زر الحالة في أثير)
  const OURS = location.hostname === "anasabdullahme-sudo.github.io" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  listen(async e => {
    if (!OURS || e.source !== window || !/^SABA_DOCTOR_(SET|GET)$/.test(e.data?.type || "")) return;
    if (e.data.type === "SABA_DOCTOR_SET") {
      const d = e.data.doctor;
      if (d === null) await chrome.storage.local.remove("sabaDoctorMe");
      else if (d && /^[A-Za-z0-9]{3,20}$/.test(d.id) && typeof d.name === "string") await chrome.storage.local.set({ sabaDoctorMe: { id: d.id, name: d.name.slice(0, 60), at: Date.now() } });
    }
    const { sabaDoctorMe: me = null } = await chrome.storage.local.get("sabaDoctorMe");
    post({ type: "SABA_DOCTOR_ME", doctor: me, version: chrome.runtime.getManifest().version });
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { announce(); keepAwake(); }, on); else { announce(); keepAwake(); }
  setTimeout(keepAwake, 3000);
  setTimeout(announce, 1500);
})();
