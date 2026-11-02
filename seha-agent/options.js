const $ = s => document.querySelector(s);
const PG = { search: "داخل صحة — صفحة البحث ✅", dashboard: "داخل صحة ✅", accounts: "يختار الحساب", login: "مو داخل صحة", redirect: "يتحوّل لنفاذ", iam: "في نفاذ — ينتظر موافقتك", loading: "الصفحة تحمّل", unknown: "صفحة غير معروفة" };
let filled = false;
async function load() {
  const c = await chrome.storage.local.get(["agentKey", "natId", "enabled", "lastState"]);
  if (!filled) { filled = true; $("#key").value = c.agentKey || ""; $("#nid").value = c.natId || ""; $("#on").checked = c.enabled !== false; }   // مرة وحدة بس (لا نمسح اللي تكتبه)
  const s = c.lastState;
  $("#st").innerHTML = !c.agentKey || !c.natId ? "<b>حط المفتاح ورقم هويتك تحت واضغط حفظ.</b>"
    : !s ? "<b>… أول تشغيل</b>"
    : `<b class="${s.ok ? "ok" : "bad"}">${PG[s.page] || s.page}</b><br><span class="mut">${s.account ? s.account + " · " : ""}آخر تحديث ${new Date(s.at).toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit" })}${s.msg ? " · " + s.msg : ""}${s.nafath?.num && Date.now() - s.nafath.at < 120000 ? ` · رقم نفاذ: <b>${s.nafath.num}</b>` : ""}</span>`;
}
$("#save").onclick = async () => {
  const key = (($("#key").value.match(/[a-f0-9]{40,}/i) || [])[0] || ""), nid = $("#nid").value.replace(/\D/g, "");
  if (!/^[a-f0-9]{40,}$/i.test(key)) { $("#msg").textContent = "المفتاح غلط — انسخه كامل من رسالة البوت"; return; }
  if (!/^[12]\d{9}$/.test(nid)) { $("#msg").textContent = "رقم الهوية لازم 10 أرقام"; return; }
  await chrome.storage.local.set({ agentKey: key, natId: nid, enabled: $("#on").checked, fails: 0, loginAt: 0, lastLoginTry: 0 });
  $("#msg").textContent = "انحفظ ✓"; filled = true; chrome.runtime.sendMessage({ type: "TICK_NOW" }).catch(() => {}); setTimeout(load, 1500);
};
$("#open").onclick = () => chrome.runtime.sendMessage({ type: "OPEN_TAB" });
$("#ver").textContent = "نسخة " + chrome.runtime.getManifest().version;
load(); setInterval(load, 5000);
