// تحديث تلقائي للأداة: برنامج صغير على الجهاز (update.ps1) ينزّل الملفات الجديدة في مجلد الأداة،
// وهنا الأداة تتأكد كل 15 دقيقة: لو فيه نسخة أحدث على الموقع تعيد تحميل نفسها (وتشتغل في التبويبات المفتوحة بدون تحديث الصفحة)
const SITE = "https://anasabdullahme-sudo.github.io/saba-leave/";
const newer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

async function check() {
  try {
    const r = await fetch(SITE + "ext-version.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const { version } = await r.json();
    const cur = chrome.runtime.getManifest().version;
    await chrome.storage.local.set({ sabaExtLatest: { version, at: Date.now() } });
    if (!newer(version, cur)) return;
    // ما نعيد التحميل وسط رفع إجازة في صحة (طلب مفتوح من أقل من 30 دقيقة)
    const { sabaReq, sabaReloadTry: t = {} } = await chrome.storage.local.get(["sabaReq", "sabaReloadTry"]);
    if (sabaReq && Date.now() - (sabaReq.sentAt || 0) < 30 * 60000) return;
    // الملفات على الجهاز ممكن لسى ما تحدّثت — نحاول مرة كل 30 دقيقة لنفس النسخة
    if (t.v === version && Date.now() - t.at < 30 * 60000) return;
    await chrome.storage.local.set({ sabaReloadTry: { v: version, at: Date.now() } });
    chrome.runtime.reload();
  } catch { /* بدون نت */ }
}

// بعد التحديث: نشغّل السكربتات الجديدة في التبويبات المفتوحة (القديمة انقطعت)
async function reinject() {
  const groups = chrome.runtime.getManifest().content_scripts || [];
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !/^https?:/.test(tab.url || "")) continue;
    for (const g of groups) {
      const hit = (g.matches || []).some(p => p === "<all_urls>" || new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(tab.url));
      if (!hit) continue;
      try { await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: !!g.all_frames }, files: g.js }); } catch { /* صفحة ما تسمح */ }
    }
  }
}

chrome.runtime.onInstalled.addListener(d => { if (d.reason === "update" || d.reason === "install") reinject(); check(); });
chrome.runtime.onStartup.addListener(check);
chrome.alarms.create("saba-update", { periodInMinutes: 15 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === "saba-update") check(); });
