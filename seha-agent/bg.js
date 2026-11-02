// أداة صحة الجانبية — الخلفية: كل 30 ثانية نشيك طلبات البحث من البوت، ونخلي صحة شغّالة، ونرسل حالتنا للبوت.
const VER = chrome.runtime.getManifest().version;
const FS = "https://firestore.googleapis.com/v1/projects/saba-leave/databases/(default)/documents/";
const SEHA = "https://seha.sa/#/Dashboard";
const DEF_ACC = { group: "سابا الطبية", role: "مدخل الإجازات المرضية", key: "البوادي" };
const MIN = 60e3;

const enc = v => v == null ? { nullValue: null } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
  : typeof v === "object" ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }
  : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v) };
const dec = v => v == null ? null : "stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue
  : "booleanValue" in v ? v.booleanValue : "nullValue" in v ? null : "arrayValue" in v ? (v.arrayValue.values || []).map(dec)
  : "mapValue" in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)])) : null;
const get = k => chrome.storage.local.get(k);
const set = o => chrome.storage.local.set(o);
const riyadhHour = () => +new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", hourCycle: "h23" }).format(new Date());

async function pending(key) {
  const r = await fetch(`${FS}agent/${key}:runQuery`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "q" }], where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "new" } } }, limit: 3 } }) });
  if (!r.ok) throw new Error("firestore " + r.status);
  return (await r.json()).filter(x => x.document).map(x => ({ id: x.document.name.split("/").pop(), ...dec({ mapValue: { fields: x.document.fields || {} } }) }));
}
async function patchQ(key, id, data) {
  const mask = Object.keys(data).map(k => "updateMask.fieldPaths=" + k).join("&");
  await fetch(`${FS}agent/${key}/q/${id}?${mask}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: enc(data).mapValue.fields }) });
}
let lastStateAt = 0, lastStateSig = "";
async function writeState(key, s, force) {
  const sig = JSON.stringify({ ...s, at: 0 });
  if (!force && sig === lastStateSig && Date.now() - lastStateAt < 60e3) return;
  lastStateSig = sig; lastStateAt = Date.now();
  const data = { ...s, at: Date.now(), ver: VER };
  await set({ lastState: data });
  await fetch(`${FS}agent/${key}/s/state`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: enc(data).mapValue.fields }) }).catch(() => {});
}

async function ensureTab(c) {
  let t = c.agentTab ? await chrome.tabs.get(c.agentTab).catch(() => null) : null;
  if (t && !/^https:\/\/(www\.)?(seha\.sa|iam\.gov\.sa)\//.test(t.url || t.pendingUrl || "")) t = null;   // الموظف فتح فيه شي ثاني
  if (!t) { t = await chrome.tabs.create({ url: SEHA, pinned: true, active: false }); await set({ agentTab: t.id }); await new Promise(r => setTimeout(r, 6000)); }
  chrome.tabs.update(t.id, { autoDiscardable: false }).catch(() => {});
  return t;
}
const send = (tabId, msg, ms = 60000) => Promise.race([chrome.tabs.sendMessage(tabId, msg).catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);

async function runQuery(c, tab, q) {
  await patchQ(c.agentKey, q.id, { status: "picked", pickedAt: Date.now() });
  const res = [];
  for (const item of (q.items || []).slice(0, 3)) {
    let r = null;
    for (let i = 0; i < 4; i++) {
      r = await send(tab.id, { type: "SEARCH", item }, 90000);
      if (!r || r.switching) { await new Promise(x => setTimeout(x, 7000)); continue; }                  // يبدّل الحساب / الصفحة تحمّل
      break;
    }
    if (!r || r.switching) r = { err: "صفحة صحة ما ردّت" };
    res.push({ id: item.id, branch: item.branch || "", rows: (r.rows || []).slice(0, 8), match: r.match ?? null, view: r.view || null, err: r.err || "" });
  }
  await patchQ(c.agentKey, q.id, { status: "done", res, doneAt: Date.now() });
}

let busy = false;
async function tick() {
  if (busy) return; busy = true;
  try {
    const c = await get(["agentKey", "natId", "enabled", "agentTab", "loginAt", "fails", "lastKeep", "lastLoginTry"]);
    if (!c.enabled || !c.agentKey || !c.natId) return;
    const queue = await pending(c.agentKey).catch(() => []);
    const tab = await ensureTab(c);
    let st = (await send(tab.id, { type: "STATE" }, 6000)) || { page: "loading" };
    // صفحة الدخول: يمكن دخلت أنت من تبويب ثاني — نحدّث تبويب الأداة أول قبل ما نطلب نفاذ
    if (st.page === "login") {
      const { lastReload } = await get("lastReload");
      if (Date.now() - (lastReload || 0) > 3 * MIN) {
        await set({ lastReload: Date.now() });
        await chrome.tabs.update(tab.id, { url: SEHA }); await new Promise(r => setTimeout(r, 8000));
        st = (await send(tab.id, { type: "STATE" }, 6000)) || { page: "loading" };
      }
    }
    let fails = c.fails || 0, msg = "";
    if (["login", "redirect", "iam"].includes(st.page)) {
      const h = riyadhHour();
      const want = queue.length > 0 || (h >= 7 && fails < 3);                        // بالليل (12–7) ما نزعجك إلا لو فيه استفسار
      const gap = queue.length ? 2 * MIN : 15 * MIN;
      if (st.page === "login" && want && Date.now() - (c.lastLoginTry || 0) > gap) {
        if (c.loginAt) fails++;                                                      // المحاولة اللي قبل ما كمّلت
        await set({ loginAt: Date.now(), lastLoginTry: Date.now(), fails, iamFor: 0 });
        await send(tab.id, { type: "CLICK_NAFATH" }, 15000);
        msg = "بدأت الدخول بنفاذ";
      } else msg = st.page === "iam" ? "ينتظر موافقة نفاذ" : "مو داخل صحة";
      if (queue.length && fails >= 3 && Date.now() - (c.lastLoginTry || 0) > 2 * MIN) await set({ fails: 2 });   // استفسار جديد = محاولة جديدة
    } else if (st.page === "accounts") {
      const acc = queue[0]?.items?.[0]?.acc || DEF_ACC; await set({ pickAcc: acc });
      const r = await send(tab.id, { type: "PICK", acc }, 20000);
      msg = r?.ok ? "اخترت الحساب" : (r?.err || "صفحة اختيار الحساب");
    } else if (st.page === "dashboard" || st.page === "search") {
      if (c.loginAt || fails) { await set({ loginAt: 0, fails: 0 }); fails = 0; }
      if (queue.length) { await writeState(c.agentKey, { page: st.page, account: st.account || "", ok: true, fails, msg: "يبحث…" }, true); for (const q of queue) await runQuery(c, tab, q).catch(e => patchQ(c.agentKey, q.id, { status: "error", err: String(e?.message || e) })); }
      else if (Date.now() - (c.lastKeep || 0) > 4 * MIN) { await send(tab.id, { type: "KEEPALIVE" }, 30000); await set({ lastKeep: Date.now() }); }
    } else if (st.page === "unknown" || st.page === "loading") {
      const { stuckSince } = await get("stuckSince");
      if (!stuckSince) await set({ stuckSince: Date.now() });
      else if (Date.now() - stuckSince > 3 * MIN) { await set({ stuckSince: 0 }); chrome.tabs.update(tab.id, { url: SEHA }); }
    }
    if (st.page !== "unknown" && st.page !== "loading") await set({ stuckSince: 0 });
    await writeState(c.agentKey, { page: st.page, account: st.account || "", ok: st.page === "dashboard" || st.page === "search", fails, msg });
  } catch (e) { console.warn("tick", e); }
  finally { busy = false; }
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    const c = await get(["agentKey", "natId", "agentTab", "loginAt", "iamFor", "fails"]);
    if (m.type === "IAM_HELLO") {
      // نفاذ (دخول صحة): نكتب هويتك ونضغط دخول — سواء الأداة بدأته أو أنت فتحته بنفسك من صحة (حتى لو انفتح في تبويب جديد)
      const g = await get(["enabled"]);
      const go = g.enabled !== false && !!c.natId && m.seha;
      if (go) { await set({ iamTab: sender.tab?.id || 0, iamAt: Date.now() }); if (c.loginAt && sender.tab?.id && sender.tab.id !== c.agentTab) await set({ agentTab: sender.tab.id }); }   // زر «الانتقال لنفاذ» يفتح تبويب جديد → نعتمده تبويب الأداة
      return { go: !!go, natId: go ? c.natId : "" };
    }
    if (m.type === "NAFATH_NUM" && c.agentKey) {
      await writeState(c.agentKey, { page: "iam", account: "", ok: false, fails: c.fails || 0, msg: "ينتظر موافقة نفاذ", nafath: { num: String(m.num), at: Date.now() } }, true);
      return { ok: true };
    }
    if (m.type === "IAM_ERR" && c.agentKey) { await writeState(c.agentKey, { page: "iam", account: "", ok: false, fails: c.fails || 0, msg: m.err || "" }, true); return { ok: true }; }
    if (m.type === "TICK_NOW") { await tick(); return { ok: true }; }
    if (m.type === "OPEN_TAB") { const t = await ensureTab(c); chrome.tabs.update(t.id, { active: true }); return { ok: true }; }
    return null;
  })().then(reply, () => reply(null));
  return true;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());     // أيقونة الأداة → صفحة الإعدادات في تبويب (مو نافذة صغيرة تنقفل)
chrome.alarms.create("tick", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === "tick") tick(); });
chrome.runtime.onStartup.addListener(() => tick());
chrome.runtime.onInstalled.addListener(d => { if (d.reason === "install") chrome.runtime.openOptionsPage(); });
