// جسر بين لوحة الموظف (سابا) والإضافة — يشتغل فقط على صفحة اللوحة
(() => {
  const isBoard = () => /لوحة الإجازات|لوحة رفع الإجازات/.test(document.title) || !!document.querySelector("#sehaDrawer");
  const post = msg => window.postMessage(msg, location.origin);

  function forwardDone() {
    chrome.storage.local.get("sabaDone", ({ sabaDone }) => {
      if (sabaDone) post({ type: "SABA_SEHA_DONE", id: sabaDone.id, ref: sabaDone.ref, psl: sabaDone.psl || "", at: sabaDone.at });
    });
  }
  function announce() {
    if (!isBoard()) return;
    post({ type: "SABA_EXT_READY", version: chrome.runtime.getManifest().version });
    forwardDone(); // لو فيه "تم" وصل واللوحة كانت مقفلة
  }

  window.addEventListener("message", e => {
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
  const active = () => chrome.storage.local.get("sabaReq", ({ sabaReq: r }) => { if (r?.id && isBoard() && Date.now() - (r.sentAt || 0) < 60 * 60000) post({ type: "SABA_ACTIVE", id: r.id }); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || !ch.sabaReq || !isBoard()) return;
    const o = ch.sabaReq.oldValue, n = ch.sabaReq.newValue;
    if (o?.id && o.id !== n?.id) post({ type: "SABA_RELEASE", id: o.id });
    if (n?.id) active();
  });
  setInterval(() => { try { active(); } catch { /* الإضافة تحدّثت — الصفحة تحتاج تحديث */ } }, 120000);
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
  window.addEventListener("message", e => {
    if (e.source !== window || e.data?.type !== "SABA_FIX_RES") return;
    const { type, ...res } = e.data;
    chrome.storage.local.set({ sabaFixRes: res }); chrome.storage.local.remove("sabaFixReq");
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", announce); else announce();
  setTimeout(announce, 1500);
})();
