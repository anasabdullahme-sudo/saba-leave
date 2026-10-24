// تنبيهات أطباء البوادي (من قروب الاستقبال) — تطلع تحت يسار فوق أي صفحة مفتوحة، 5 ثواني
(() => {
  if (window.top !== window) return;
  let host = null, wrap = null;
  const COLORS = { red: ["#E5383B", "#B4232A"], green: ["#0E9F6E", "#0A7A55"], orange: ["#E59A1A", "#9A5B00"], blue: ["#0082D4", "#0B5FA5"] };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function ensure() {
    if (host && document.documentElement.contains(host)) return;
    document.getElementById("saba-doc-alerts")?.remove();
    host = document.createElement("div"); host.id = "saba-doc-alerts";
    host.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483647";
    const root = host.attachShadow({ mode: "open" });
    const CSS = `
      .w{display:flex;flex-direction:column;gap:8px;direction:rtl;font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif}
      .a{display:flex;width:min(360px,calc(100vw - 32px));background:#fff;border-radius:14px;box-shadow:0 14px 40px -10px rgba(0,25,50,.45),0 0 0 1px rgba(0,55,101,.08);overflow:hidden;position:relative;animation:in .25s ease-out}
      @keyframes in{from{transform:translateY(16px);opacity:0}}
      .sd{width:7px;flex:none}.in{flex:1;padding:10px 14px 12px;display:grid;gap:1px;text-align:right}
      .l{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:700}
      .l span{margin-inline-start:auto;font-weight:500;font-size:12px;color:#8AA0B4}
      .l button{all:unset;cursor:pointer;color:#8AA0B4;font-size:15px;padding:0 4px}
      .n{font-size:18px;font-weight:700;color:#0B2B47}.m{font-size:12.5px;color:#5B7690}
      .bar{position:absolute;left:0;right:7px;bottom:0;height:3px}.bar i{display:block;height:100%;width:100%;margin-inline-start:auto;transition:width 5s linear}
    `;
    // ستايل بدون <style> (بعض المواقع تمنع الستايل المضاف بسياسة CSP)
    try { const sh = new CSSStyleSheet(); sh.replaceSync(CSS); root.adoptedStyleSheets = [sh]; root.innerHTML = '<div class="w"></div>'; }
    catch { root.innerHTML = `<style>${CSS}</style><div class="w"></div>`; }
    wrap = root.querySelector(".w");
    document.documentElement.append(host);
  }
  function show(ev) {
    ensure();
    const [c1, c2] = COLORS[ev.color] || COLORS.blue;
    const time = new Date(ev.at).toLocaleTimeString("ar-SA", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" });
    const meta = [ev.info, ev.dep, ev.room ? "غرفة " + ev.room : "", ev.ext ? "تحويلة " + ev.ext : ""].filter(Boolean).join(" · ");
    const el = document.createElement("div"); el.className = "a";
    el.innerHTML = `<div class="sd"></div><div class="in"><div class="l"><b>${esc(ev.title)}</b><span>${time}</span><button aria-label="إغلاق">✕</button></div>
      <div class="n">د. ${esc(ev.name)}</div>${meta ? `<div class="m">${esc(meta)}</div>` : ""}</div><div class="bar"><i></i></div>`;
    el.querySelector(".sd").style.background = c1; el.querySelector(".l").style.color = c2;           // عبر CSSOM (ما تمنعه CSP)
    el.querySelector(".bar").style.background = c1 + "33"; el.querySelector(".bar i").style.background = c1;
    el.querySelector("button").onclick = () => el.remove();
    wrap.append(el);
    while (wrap.children.length > 3) wrap.firstElementChild.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => { const b = el.querySelector(".bar i"); if (b) b.style.width = "0%"; }));
    setTimeout(() => el.remove(), 5200);
  }
  const shown = new Set();
  chrome.storage.onChanged.addListener((ch, area) => {
    const ev = area === "local" && ch.sabaDocAlert?.newValue;
    if (!ev || shown.has(ev.id)) return;                                  // نفس التنبيه من أكثر من تبويب
    shown.add(ev.id);
    if (document.visibilityState !== "visible") return;                  // التبويب اللي قدامك بس
    if (Date.now() - (ev.shownAt || ev.at) > 60000) return;
    show(ev);
  });
})();
