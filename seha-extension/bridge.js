// جسر بين لوحة الموظف (سابا) والإضافة — يشتغل فقط على صفحة اللوحة
(() => {
  const isBoard = () => /لوحة الإجازات|لوحة رفع الإجازات/.test(document.title) || !!document.querySelector("#sehaDrawer");
  const post = msg => window.postMessage(msg, location.origin);
  // بعد تحديث/إعادة تحميل الإضافة تبقى النسخة القديمة في الصفحة بدون اتصال — نوقفها بهدوء بدل الأخطاء
  const ac = new AbortController(), on = { signal: ac.signal };
  let timer = 0;
  const alive = () => { try { if (chrome.runtime?.id) return true; } catch {} ac.abort(); clearInterval(timer); return false; };
  const listen = fn => window.addEventListener("message", e => { if (!alive()) return; try { const r = fn(e); r?.catch?.(() => {}); } catch { alive(); } }, on);

  function forwardDone() {
    if (!alive()) return;
    chrome.storage.local.get("sabaDone", ({ sabaDone }) => {
      if (sabaDone) post({ type: "SABA_SEHA_DONE", id: sabaDone.id, ref: sabaDone.ref, psl: sabaDone.psl || "", at: sabaDone.at });
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
    if (m.type === "SABA_QUEUE" && Array.isArray(m.items)) chrome.storage.local.set({ sabaQueue: { at: Date.now(), items: m.items.slice(0, 200) } });
    if (m.type === "SABA_SEHA_DONE_ACK") {
      chrome.storage.local.get("sabaDone", ({ sabaDone }) => { if (sabaDone && sabaDone.at === m.at) chrome.storage.local.remove("sabaDone"); });
    }
  });

  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.sabaDone?.newValue) forwardDone(); });
  // الطلب المفتوح في صحة بهالجهاز → اللوحة تحجزه («مفتوح عند فلان» عند الباقين)
  const active = () => alive() && chrome.storage.local.get("sabaReq", ({ sabaReq: r }) => { if (r?.id && isBoard() && Date.now() - (r.sentAt || 0) < 60 * 60000) post({ type: "SABA_ACTIVE", id: r.id }); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || !ch.sabaReq || !isBoard()) return;
    const o = ch.sabaReq.oldValue, n = ch.sabaReq.newValue;
    if (o?.id && o.id !== n?.id) post({ type: "SABA_RELEASE", id: o.id });
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", announce, on); else announce();
  setTimeout(announce, 1500);
})();
