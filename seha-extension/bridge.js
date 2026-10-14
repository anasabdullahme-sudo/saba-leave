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
      chrome.storage.local.set({ sabaReq: m.payload, sabaNavFor: "" }, () => post({ type: "SABA_SEHA_FILL_ACK", ref: m.payload.ref }));
    }
    if (m.type === "SABA_SEHA_DONE_ACK") {
      chrome.storage.local.get("sabaDone", ({ sabaDone }) => { if (sabaDone && sabaDone.at === m.at) chrome.storage.local.remove("sabaDone"); });
    }
  });

  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.sabaDone?.newValue) forwardDone(); });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", announce); else announce();
  setTimeout(announce, 1500);
})();
