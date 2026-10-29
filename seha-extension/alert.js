// تنبيهات أطباء البوادي (من قروب الاستقبال) — تحت يسار فوق أي صفحة مفتوحة
// - «وقف استقبال» و«فاضي دخلوا له»: تبقى 3 دقايق أو لين الموظف يشيلها، وغيرها 5 ثواني
// - التنبيه الجديد يطلع فوق اللي قبله (ما يغطيه)، ولو فيه أكثر من تنبيه يصغرون عشان ما يغطون الشاشة
// - أداة صحة تنزاح فوق التنبيهات ولا تنغطى، وترجع مكانها لما تروح
(() => {
  if (window.top !== window) return;
  let host = null, wrap = null;
  const COLORS = { red: ["#E5383B", "#B4232A"], green: ["#0E9F6E", "#0A7A55"], orange: ["#E59A1A", "#9A5B00"], blue: ["#0082D4", "#0B5FA5"] };
  const STICKY = new Set(["stop", "free", "resume"]);           // المهمة: تبقى 3 دقايق
  const STICKY_MS = 3 * 60000, SHORT_MS = 5000, MAX = 4;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function ensure() {
    if (host && document.documentElement.contains(host)) return;
    document.getElementById("saba-doc-alerts")?.remove();
    host = document.createElement("div"); host.id = "saba-doc-alerts";
    host.style.cssText = "all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483647";
    const root = host.attachShadow({ mode: "open" });
    const CSS = `
      .w{display:flex;flex-direction:column-reverse;gap:8px;direction:rtl;font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif}
      .a{display:flex;width:min(360px,calc(100vw - 32px));background:#fff;border-radius:14px;box-shadow:0 14px 40px -10px rgba(0,25,50,.45),0 0 0 1px rgba(0,55,101,.08);overflow:hidden;position:relative;animation:in .25s ease-out;transition:width .2s}
      @keyframes in{from{transform:translateY(16px);opacity:0}}
      .sd{width:7px;flex:none}.in{flex:1;padding:10px 14px 12px;display:grid;gap:1px;text-align:right}
      .l{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700}
      .l span{margin-inline-start:auto;font-weight:500;font-size:12px;color:#8AA0B4}
      .l button{all:unset;cursor:pointer;color:#8AA0B4;font-size:15px;padding:0 4px}
      .l button:hover{color:#0B2B47}
      .n{font-size:18px;font-weight:700;color:#0B2B47}.m{font-size:12.5px;color:#5B7690}
      .bar{position:absolute;left:0;right:7px;bottom:0;height:3px}.bar i{display:block;height:100%;width:100%;margin-inline-start:auto;transition-property:width;transition-timing-function:linear}
      /* أكثر من تنبيه: حجم أصغر */
      .w.many .a{width:min(290px,calc(100vw - 32px));border-radius:11px}
      .w.many .in{padding:6px 10px 8px}
      .w.many .l{font-size:12px}.w.many .l span{font-size:11px}
      .w.many .n{font-size:14.5px}
      .w.many .m{font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .w.many .sd{width:5px}
    `;
    // ستايل بدون <style> (بعض المواقع تمنع الستايل المضاف بسياسة CSP)
    try { const sh = new CSSStyleSheet(); sh.replaceSync(CSS); root.adoptedStyleSheets = [sh]; root.innerHTML = '<div class="w"></div>'; }
    catch { root.innerHTML = `<style>${CSS}</style><div class="w"></div>`; }
    wrap = root.querySelector(".w");
    document.documentElement.append(host);
  }
  // مساحة التنبيهات → أداة صحة تنزاح فوقها (نفس الإضافة، نفس العالم المعزول)
  function announce() {
    requestAnimationFrame(() => {
      const n = wrap ? wrap.children.length : 0;
      wrap?.classList.toggle("many", n > 1);
      requestAnimationFrame(() => {
        const r = n && host ? host.getBoundingClientRect() : null;
        window.dispatchEvent(new CustomEvent("saba-alert-area", { detail: JSON.stringify(r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null) }));
      });
    });
  }
  function removeEl(el) { if (!el.isConnected) return; clearTimeout(el._t); el.remove(); announce(); }
  function show(ev) {
    ensure();
    const sticky = STICKY.has(ev.kind) || ev.color === "red" && /وقف/.test(ev.title || "");
    const life = sticky ? STICKY_MS : SHORT_MS;
    const [c1, c2] = COLORS[ev.color] || COLORS.blue;
    const time = new Date(ev.at).toLocaleTimeString("ar-SA", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" });
    const meta = [ev.info, ev.dep, ev.room ? "غرفة " + ev.room : "", ev.ext ? "تحويلة " + ev.ext : ""].filter(Boolean).join(" · ");
    const el = document.createElement("div"); el.className = "a"; el.dataset.sticky = sticky ? "1" : "";
    el.innerHTML = `<div class="sd"></div><div class="in"><div class="l"><b>${esc(ev.title)}</b><span>${time}</span><button aria-label="إغلاق" title="إغلاق">✕</button></div>
      <div class="n">د. ${esc(ev.name)}</div>${meta ? `<div class="m" title="${esc(meta)}">${esc(meta)}</div>` : ""}</div><div class="bar"><i></i></div>`;
    el.querySelector(".sd").style.background = c1; el.querySelector(".l").style.color = c2;           // عبر CSSOM (ما تمنعه CSP)
    el.querySelector(".bar").style.background = c1 + "33"; const bi = el.querySelector(".bar i"); bi.style.background = c1; bi.style.transitionDuration = life + "ms";
    el.querySelector("button").onclick = () => removeEl(el);
    // «وقف» ثم «فاضي» لنفس الطبيب: الجديد يلغي القديم (غير كذا التنبيهات تتكدس فوق بعض)
    if (sticky) for (const old of [...wrap.children]) if (old.dataset.sticky && old.dataset.doc && old.dataset.doc === (ev.doctorId || ev.name)) removeEl(old);
    el.dataset.doc = ev.doctorId || ev.name || "";
    wrap.append(el);                                             // column-reverse: الجديد يطلع فوق
    while (wrap.children.length > MAX) {                          // الزحمة: نشيل أقدم القصير أولاً، وبعدها أقدم المهم
      const victim = [...wrap.children].find(x => !x.dataset.sticky) || wrap.firstElementChild;
      removeEl(victim);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { if (bi) bi.style.width = "0%"; }));
    el._t = setTimeout(() => removeEl(el), life + 200);
    announce();
  }
  const shown = new Set();
  chrome.storage.onChanged.addListener((ch, area) => {
    const ev = area === "local" && ch.sabaDocAlert?.newValue;
    if (!ev || shown.has(ev.id)) return;                                  // نفس التنبيه من أكثر من مصدر
    shown.add(ev.id);
    if (document.visibilityState !== "visible") return;                  // التبويب اللي قدامك بس
    if (Date.now() - (ev.shownAt || ev.at) > 60000) return;
    chrome.storage.local.get("sabaDoctorMe", r => { if (!r.sabaDoctorMe) show(ev); });   // جهاز طبيب: ما نزعجه بتنبيهات الاستقبال
  });
  addEventListener("resize", announce);
})();
