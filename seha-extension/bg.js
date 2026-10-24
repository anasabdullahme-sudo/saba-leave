// تحديث تلقائي من متجر كروم: أول ما تنزل نسخة جديدة نطبّقها (إذا ما فيه رفع إجازة شغّال في صحة)،
// وبعد التحديث نشغّل السكربتات الجديدة في التبويبات المفتوحة بدون ما الموظف يحدّث الصفحة
async function safeToReload() {
  const { sabaReq } = await chrome.storage.local.get("sabaReq");
  return !(sabaReq && Date.now() - (sabaReq.sentAt || 0) < 30 * 60000);
}
let pending = false;
chrome.runtime.onUpdateAvailable.addListener(async () => { pending = true; if (await safeToReload()) chrome.runtime.reload(); });

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
chrome.runtime.onInstalled.addListener(d => { if (d.reason === "update") reinject(); });

// نسأل المتجر كل ساعة (بدل ما ننتظر كروم ساعات)، ولو فيه تحديث معلّق نطبّقه أول ما يصير آمن
chrome.alarms.create("saba-update", { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== "saba-update") return;
  if (pending && await safeToReload()) return chrome.runtime.reload();
  try { chrome.runtime.requestUpdateCheck(() => {}); } catch { /* نسخة محمّلة يدوي */ }
});
