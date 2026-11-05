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

// صورة التقرير في تبويب خاص بالإضافة (صفحة صحة ممكن تمنع عرض الصور داخلها)
chrome.runtime.onMessage.addListener((m, sender) => {
  if (m?.type === "SABA_OPEN_IMG") chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
  // (1.9.2) تبويب لوحة الموظفين: كروم ما يطفيه لتوفير الذاكرة (كان يطفيه والقائمة تقدم)
  if (m?.type === "SABA_BOARD_HERE" && sender?.tab?.id) chrome.tabs.update(sender.tab.id, { autoDiscardable: false }).catch(() => {});
  if (m?.type === "SABA_NEED_BOARD") ensureBoard();
});
// أداة صحة ما وصلتها قائمة واللوحة مو مفتوحة أبداً → نفتحها مثبّتة بالخلفية (مرة كل دقيقتين بالكثير)
const BOARD_URL = "https://anasabdullahme-sudo.github.io/saba-leave/staff.html";
let boardOpenedAt = 0;
async function ensureBoard() {
  if (Date.now() - boardOpenedAt < 120000) return;
  try {
    const tabs = await chrome.tabs.query({ url: "https://anasabdullahme-sudo.github.io/saba-leave/staff*" });
    if (tabs.length) { for (const t of tabs) if (t.discarded) chrome.tabs.reload(t.id).catch(() => {}); return; }
    boardOpenedAt = Date.now();
    await chrome.tabs.create({ url: BOARD_URL, pinned: true, active: false });
  } catch { /* */ }
}

/* ---------- تنبيهات الأطباء بدون ما تكون صفحة سابا مفتوحة ----------
   كل 30 ثانية (وقت الدوام بس) نشيك حالات اليوم؛ أي حدث جديد يطلع تنبيه صغير في التبويب اللي قدامك،
   ولو كروم مو قدامك (برنامج ثاني فاتح) يطلع إشعار ويندوز */
const TODAY_URL = "https://firestore.googleapis.com/v1/projects/saba-leave/databases/(default)/documents/board/bawadi_today";
const dec = v => v == null ? null : "stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue
  : "booleanValue" in v ? v.booleanValue : "nullValue" in v ? null : "arrayValue" in v ? (v.arrayValue.values || []).map(dec)
  : "mapValue" in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)])) : null;
const riyadhHour = () => +new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", hourCycle: "h23" }).format(new Date());
chrome.alarms.create("saba-alerts", { periodInMinutes: 0.5 });
let polling = false, lastPoll = 0;
async function pollAlerts() {
  if (polling) return; polling = true;
  try {
    const h = riyadhHour(); if (h >= 1 && h < 7) return;                          // آخر الليل ما فيه دوام
    const st = await chrome.storage.local.get(["sabaDoctorMe", "sabaDocSeen", "sabaBoardCache", "sabaAlertsInit"]);
    if (st.sabaDoctorMe) return;                                                   // جهاز طبيب
    // (1.9.5) توفير قراءات: لو صفحة سابا مفتوحة هي اللي توصل التنبيهات (تقرأ بس لما يتغير شي) → نقرأ بنفسنا كل 5 دقايق بس
    // (بدل كل 30 ثانية = 120 قراءة بالساعة لكل جهاز)
    const pages = await chrome.tabs.query({ url: "https://anasabdullahme-sudo.github.io/saba-leave/*" }).catch(() => []);
    if (pages.some(t => !t.discarded && /\/(staff|home|doctors)\.html/.test(t.url || "")) && Date.now() - lastPoll < 5 * 60000) return;
    lastPoll = Date.now();
    const r = await fetch(TODAY_URL); if (!r.ok) return;
    const today = dec({ mapValue: { fields: (await r.json()).fields || {} } });
    const c = st.sabaBoardCache || {};
    // الجدول تعدّل (يدوي من صفحة الأطباء أو من البوت)؟ نحدّثه على طول بدل ما ننتظر 10 دقايق
    let board = c.board, bAt = c.at;
    if (today?.boardAt && today.boardAt !== (c.board?.updatedAt || 0)) {
      try { const rb = await fetch(TODAY_URL.replace(/bawadi_today$/, "bawadi")); if (rb.ok) { const b = dec({ mapValue: { fields: (await rb.json()).fields || {} } }); if (b?.departments) { board = b; bAt = Date.now(); } } } catch {}
    }
    await chrome.storage.local.set({ sabaBoardCache: { ...c, board, at: bAt, today, tAt: Date.now() } });   // بطاقة أثير تستفيد من نفس القراءة
    let seen = st.sabaDocSeen || [];
    const fresh = (today?.events || []).filter(e => e?.id && !seen.includes(e.id) && Date.now() - (e.at || 0) < (st.sabaAlertsInit ? 10 : 2) * 60000);
    if (!st.sabaAlertsInit) await chrome.storage.local.set({ sabaAlertsInit: Date.now() });
    for (const ev of fresh.slice(-3)) {
      seen = [...seen, ev.id].slice(-150);
      await chrome.storage.local.set({ sabaDocAlert: { ...ev, shownAt: Date.now(), via: "bg" }, sabaDocSeen: seen });
      await showOutside(ev);
      await new Promise(x => setTimeout(x, 400));
    }
    if (fresh.length > 3) await chrome.storage.local.set({ sabaDocSeen: [...seen, ...fresh.map(e => e.id)].slice(-150) });
  } catch { /* بدون نت */ } finally { polling = false; }
}
// كروم مو قدام الموظف (أو التبويب صفحة ما نقدر نطلع فيها شي) → إشعار ويندوز
async function showOutside(ev) {
  try {
    const w = await chrome.windows.getLastFocused({ populate: true });
    const tab = w?.tabs?.find(t => t.active);
    if (w?.focused && tab && /^https?:/.test(tab.url || "")) return;              // التنبيه الصغير بيطلع في الصفحة
    if (!chrome.notifications || !(await chrome.permissions.contains({ permissions: ["notifications"] }))) return;   // إشعارات ويندوز اختيارية (ما نطلب صلاحية جديدة في التحديث)
    const meta = [ev.info, ev.dep, ev.room ? "غرفة " + ev.room : "", ev.ext ? "تحويلة " + ev.ext : ""].filter(Boolean).join(" · ");
    chrome.notifications.create("saba-" + ev.id, { type: "basic", iconUrl: "icon128.png", title: `${ev.title || "تحديث"} — د. ${ev.name || ""}`, message: meta || " ", priority: 1 });
  } catch { /* بدون صلاحية الإشعارات */ }
}
chrome.alarms.onAlarm.addListener(a => { if (a.name === "saba-alerts") pollAlerts(); });
chrome.runtime.onStartup.addListener(pollAlerts);
