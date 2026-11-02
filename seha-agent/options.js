const $ = s => document.querySelector(s);
const PG = { search: "داخل صحة — صفحة البحث ✅", dashboard: "داخل صحة ✅", accounts: "يختار الحساب", login: "مو داخل صحة", redirect: "يتحوّل لنفاذ", iam: "في نفاذ — ينتظر موافقتك", loading: "الصفحة تحمّل", unknown: "صفحة غير معروفة" };
let filled = false;
async function load() {
  const c = await chrome.storage.local.get(["agentKey", "natId", "enabled", "lastState", "syncOk", "syncErr", "syncErrAt", "pendErr"]);
  if (!filled) { filled = true; $("#key").value = c.agentKey || ""; $("#nid").value = c.natId || ""; $("#on").checked = c.enabled !== false; }   // مرة وحدة بس (لا نمسح اللي تكتبه)
  const s = c.lastState;
  $("#st").innerHTML = !c.agentKey || !c.natId ? "<b>حط المفتاح ورقم هويتك تحت واضغط حفظ.</b>"
    : !s ? "<b>… أول تشغيل</b>"
    : `<b class="${s.ok ? "ok" : "bad"}">${PG[s.page] || s.page}</b><br><span class="mut">${s.account ? s.account + " · " : ""}آخر تحديث ${new Date(s.at).toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit" })}${s.msg ? " · " + s.msg : ""}${s.nafath?.num && Date.now() - s.nafath.at < 120000 ? ` · رقم نفاذ: <b>${s.nafath.num}</b>` : ""}</span>`
      + `<br><span class="${c.syncErr ? "bad" : "ok"}" style="font-size:12.5px">${c.syncErr ? "⚠ ما يوصل للبوت: " + c.syncErr : c.syncOk ? "✓ متصل بالبوت — آخر مزامنة " + new Date(c.syncOk).toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit" }) : "… ما تزامن مع البوت للحين"}</span>`
      + (c.pendErr ? `<br><span class="bad" style="font-size:12.5px">⚠ قراءة طلبات البوت: ${c.pendErr}</span>` : "");
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

// ---------- تجربة بحث ----------
let lastRes = null;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
$("#test").onclick = async () => {
  const id = $("#tid").value.replace(/\D/g, "");
  if (!/^[12]\d{9}$/.test(id)) { $("#tmsg").textContent = "رقم الهوية لازم 10 أرقام"; return; }
  const from = $("#tfrom").value.trim();
  $("#test").disabled = true; $("#tres").textContent = ""; $("#tbtns").hidden = true; $("#tmsg").textContent = "يبحث… (ممكن ياخذ دقيقة)";
  const iv = setInterval(async () => { const { testStep } = await chrome.storage.local.get("testStep"); if (testStep) $("#tmsg").textContent = "يبحث… " + testStep; }, 1500);
  try {
    const r = await chrome.runtime.sendMessage({ type: "TEST_SEARCH", id, leaveStart: from });
    lastRes = r;
    if (!r) { $("#tres").innerHTML = '<b class="bad">ما ردّت الأداة</b>'; return; }
    let out = "";
    if (r.err) out += `<b class="bad">⚠ ${esc(r.err)}</b>\n`;
    else if (!r.rows?.length) out += `<b class="ok">✓ البحث اشتغل — ما فيه إجازات بهالهوية</b>\n`;
    else {
      out += `<b class="ok">✓ البحث اشتغل — ${r.rows.length} إجازة</b>\n`;
      r.rows.forEach((x, i) => { out += `${i === r.match ? "👉 " : "• "}${esc(x.status || "—")}${x.pay ? " · " + esc(x.pay) : ""} · ${esc(x.type || "")} · طلب ${esc(x.date || "")} · ${esc(x.psl || "")}\n`; });
      if (r.view?.from) out += `📅 تاريخ الإجازة من «عرض»: ${esc(r.view.from)} ← ${esc(r.view.to || "؟")}\n`;
    }
    out += `\n<span class="mut">السجل:\n${esc((r.log || []).join("\n"))}</span>`;
    $("#tres").innerHTML = out; $("#tbtns").hidden = false; $("#savehtml").hidden = !r.debug;
  } catch (e) { $("#tres").innerHTML = `<b class="bad">${esc(e?.message || e)}</b>`; }
  finally { clearInterval(iv); $("#test").disabled = false; $("#tmsg").textContent = ""; }
};
$("#copylog").onclick = async () => {
  const r = lastRes || {};
  const t = [`أداة صحة ${chrome.runtime.getManifest().version} — تجربة بحث`, r.err ? "خطأ: " + r.err : `نتائج: ${r.rows?.length || 0} · مطابق: ${r.match ?? "—"} · عرض: ${r.view?.from || "—"} ← ${r.view?.to || "—"}`,
    ...(r.rows || []).map(x => `- ${x.status} | ${x.pay || ""} | ${x.type || ""} | ${x.date || ""}`), "", ...(r.log || [])].join("\n").replace(/\b[12]\d{9}\b/g, m => m.slice(0, 3) + "****" + m.slice(-3));
  await navigator.clipboard.writeText(t); $("#tmsg").textContent = "انسخ ✓ — الصقه لـ Claude";
};
$("#savehtml").onclick = () => {
  const d = lastRes?.debug; if (!d) return;
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([`<!-- ${d.url} · ${d.page} -->\n` + d.html], { type: "text/html" })); a.download = "seha-page.html"; a.click();
};
