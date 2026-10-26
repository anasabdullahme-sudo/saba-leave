// زر الطبيب في أثير — يطلع بس على جهاز طبيب انربط مرة وحدة من صفحة «ربط جهاز الطبيب» في موقع سابا.
// الطبيب يضغط «وقف استقبال» وغيره → يوصل للبوت → يتحدث جدول المتواجدين + تنبيه عند الموظفين + رسالة في قروب الاستقبال
(() => {
  if (window.top !== window) return;
  const BASE = "https://firestore.googleapis.com/v1/projects/saba-leave/databases/(default)/documents/";
  const OPTS = [
    { k: "stop", t: "⛔ وقف استقبال", c: "#E5383B", s: "موقف الاستقبال" },
    { k: "free", t: "✅ أستقبل حالات", c: "#0E9F6E", s: "تستقبل حالات" },
    { k: "busy", t: "⏳ عندي انتظار", c: "#E59A1A", s: "عندك انتظار" },
    { k: "appt", t: "📅 مواعيد فقط", c: "#0082D4", s: "مواعيد فقط" },
  ];
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dec = v => v == null ? null : "stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue
    : "booleanValue" in v ? v.booleanValue : "nullValue" in v ? null : "arrayValue" in v ? (v.arrayValue.values || []).map(dec)
    : "mapValue" in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)])) : null;
  const isoNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());

  let me = null, pc = "", host = null, root = null, open = false, cur = "", note = "", sending = false;

  async function readState() {
    try {
      const r = await fetch(BASE + "board/bawadi_today"); if (!r.ok) return null;
      const t = dec({ mapValue: { fields: (await r.json()).fields || {} } });
      if (t?.date !== isoNow()) return { kind: "", at: 0 };
      const s = t.st?.[me.id]; return s ? { kind: s.kind === "present" ? "free" : s.kind, at: s.at || 0 } : { kind: "", at: 0 };
    } catch { return null; }
  }
  async function refresh() { const s = await readState(); if (s) { cur = s.kind; render(); } }

  async function send(k) {
    if (sending || !alive()) return; sending = true; note = "⏳ يرسل…"; render();
    const at = Date.now();
    try {
      const r = await fetch(BASE + "signals", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { doctorId: { stringValue: me.id }, kind: { stringValue: k }, at: { integerValue: String(at) }, pc: { stringValue: pc } } }) });
      if (!r.ok) throw new Error(r.status);
      // نتأكد إن البوت طبّقها (تبان في حالات اليوم)
      let ok = false;
      for (let i = 0; i < 10 && !ok; i++) { await new Promise(x => setTimeout(x, 2000)); const s = await readState(); if (s && s.kind === k && s.at >= at - 5000) { ok = true; cur = k; } }
      note = ok ? "✓ وصل للاستقبال" : "انرسل — بيوصلهم أول ما يشتغل البوت";
      if (ok) setTimeout(() => { open = false; note = ""; render(); }, 2500);
    } catch { note = "⚠ ما انرسل — تأكد من النت وجرّب مرة ثانية"; }
    sending = false; render();
  }

  function render() {
    if (!me) { host?.remove(); host = null; return; }
    if (!host || !document.documentElement.contains(host)) {
      document.getElementById("saba-doc-btn")?.remove();
      host = document.createElement("div"); host.id = "saba-doc-btn";
      host.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646";
      root = host.attachShadow({ mode: "open" });
      const CSS = `
        .w{direction:rtl;font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif;display:grid;gap:6px;justify-items:end}
        .pill{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;background:#fff;border-radius:999px;padding:8px 14px;box-shadow:0 10px 28px -10px rgba(0,25,50,.5),0 0 0 1px rgba(0,55,101,.1);font-size:14px;font-weight:700;color:#0B2B47}
        .dot{width:10px;height:10px;border-radius:50%;flex:none}
        .pill small{font-weight:500;color:#5B7690;font-size:12.5px}
        .card{background:#fff;border-radius:14px;padding:10px;box-shadow:0 14px 40px -10px rgba(0,25,50,.45),0 0 0 1px rgba(0,55,101,.08);display:grid;gap:6px;width:220px}
        .card b{font-size:13px;color:#5B7690;font-weight:600;padding:0 4px}
        .o{all:unset;cursor:pointer;text-align:right;padding:9px 12px;border-radius:10px;font-size:14.5px;font-weight:700;color:#0B2B47;background:#F3F7FA;border:2px solid transparent}
        .o:hover{background:#E8F1F8}.o.on{border-color:currentColor}.o[disabled]{opacity:.5;cursor:wait}
        .n{font-size:12.5px;color:#0B2B47;padding:2px 4px}`;
      try { const sh = new CSSStyleSheet(); sh.replaceSync(CSS); root.adoptedStyleSheets = [sh]; root.innerHTML = '<div class="w"></div>'; }
      catch { root.innerHTML = `<style>${CSS}</style><div class="w"></div>`; }
      document.documentElement.append(host);
    }
    const st = OPTS.find(o => o.k === cur) || OPTS[1];
    const w = root.querySelector(".w");
    w.innerHTML = (open ? `<div class="card"><b>د. ${esc(me.name)}</b>${OPTS.map(o => `<button class="o${o.k === cur ? " on" : ""}" data-k="${o.k}" ${sending ? "disabled" : ""}>${o.t}</button>`).join("")}${note ? `<div class="n">${esc(note)}</div>` : ""}</div>` : "")
      + `<button class="pill"><span class="dot"></span>${open ? "إغلاق" : `حالتي <small>${esc(st.s)}</small>`}</button>`;
    w.querySelector(".dot").style.background = st.c;
    w.querySelectorAll(".o").forEach(b => { b.style.color = OPTS.find(o => o.k === b.dataset.k).c; b.onclick = () => send(b.dataset.k); });
    w.querySelector(".pill").onclick = () => { open = !open; note = ""; render(); if (open) refresh(); };
  }

  chrome.storage.local.get(["sabaDoctorMe", "sabaPcId"], r => {
    me = r.sabaDoctorMe || null;
    pc = r.sabaPcId || Math.random().toString(36).slice(2, 12);
    if (!r.sabaPcId) chrome.storage.local.set({ sabaPcId: pc });
    render(); if (me) refresh();
  });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && "sabaDoctorMe" in ch) { me = ch.sabaDoctorMe.newValue || null; render(); if (me) refresh(); } });
  const iv = setInterval(() => { if (!alive()) { clearInterval(iv); host?.remove(); return; } if (me && document.visibilityState === "visible" && !sending) refresh(); }, 120000);
})();
