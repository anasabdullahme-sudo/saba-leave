// أثير (saba.athir.net): لما الموظف يختار طبيب في «كشف جديد» يطلع جنب خانة الطبيب: الدور، العيادة، التحويلة، وحالته الحين
(() => {
  if (window.top !== window && !document.querySelector("select")) return;
  const URL_BASE = "https://firestore.googleapis.com/v1/projects/saba-leave/databases/(default)/documents/board/";
  const WD = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const FLOOR_DEF = { B: "عيادة التجميل (بيوتي)", G: "الدور الأرضي", 1: "الدور الأول", 2: "الدور الثاني", 3: "الدور الثالث", 4: "الدور الرابع", 5: "الدور الخامس" };
  let board = null, today = null, lastFetch = 0, host = null, box = null, field = null, lastSig = "";

  /* ---------- البيانات (جدول البوادي — قراءة عامة) ---------- */
  const dec = v => v == null ? null : "stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue
    : "booleanValue" in v ? v.booleanValue : "nullValue" in v ? null : "arrayValue" in v ? (v.arrayValue.values || []).map(dec)
    : "mapValue" in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)])) : "timestampValue" in v ? Date.parse(v.timestampValue) : null;
  const getDoc = async name => { const r = await fetch(URL_BASE + name); if (!r.ok) return null; const j = await r.json(); return dec({ mapValue: { fields: j.fields || {} } }); };
  // نقرأ من قاعدة البيانات بس لما تنفتح خانة الطبيب، ونشارك النسخة بين التبويبات (الجدول كل 10 دقائق، حالات اليوم كل دقيقتين)
  let busy = false;
  async function load() {
    if (busy || Date.now() - lastFetch < 20000) return; busy = true; lastFetch = Date.now();
    try {
      const { sabaBoardCache: c = {} } = await chrome.storage.local.get("sabaBoardCache");
      const needB = !c.board || Date.now() - (c.at || 0) > 10 * 60000, needT = Date.now() - (c.tAt || 0) > 2 * 60000;
      const [b, t] = await Promise.all([needB ? getDoc("bawadi") : c.board, needT ? getDoc("bawadi_today") : c.today]);
      if (b?.departments) board = b; today = t || null;
      if (needB || needT) chrome.storage.local.set({ sabaBoardCache: { board: board || c.board, at: needB ? Date.now() : c.at, today, tAt: needT ? Date.now() : c.tAt } });
    } catch { /* بدون نت — نكمل بالنسخة المحفوظة */ }
    busy = false; lastSig = ""; tick();
  }

  /* ---------- مطابقة اسم أثير (الاسم الكامل | التخصص) مع جدول البوادي ---------- */
  const norm = s => String(s || "").replace(/[ً-ْـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ء/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const deAl = t => t.length > 4 && t.startsWith("ال") ? t.slice(2) : t;
  const toks = s => norm(s).split(" ").filter(t => t.length > 1 && !["د", "دكتور", "دكتوره", "اخصائي", "اخصائيه", "استشاري", "استشاريه"].includes(t)).map(deAl);
  // حرف زايد/ناقص/مختلف مسموح في الأسماء: نرمين ≈ نيرمين
  const lev1 = (a, b) => { if (Math.abs(a.length - b.length) > 1) return false; let i = 0, j = 0, e = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } } return e + (a.length - i) + (b.length - j) <= 1; };
  const near = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && lev1(a, b)) || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));
  const docs = () => (board?.departments || []).flatMap(p => (p.doctors || []).map(d => ({ ...d, dep: p, fl: d.floor || p.floor })));
  function matchAthir(text) {
    const full = toks(String(text).split("|")[0]);
    if (!full.length) return null;
    const scored = docs().map(d => {
      const bt = toks(String(d.name).split(/\s*[–-]\s*/)[0]); let hit = bt.filter(t => full.some(f => near(f, t))).length, n = bt.length, first = bt[0] && near(bt[0], full[0]);
      if (d.fullName) {                                                  // الاسم الكامل من شيت الموظفين: أثير يكتب أجزاء منه (وائل محمد الهجين ⊂ وائل محمد عبدالله الهجين)
        const ft = toks(d.fullName), fh = full.filter(f => ft.some(t => near(f, t))).length;
        if (ft[0] && near(ft[0], full[0]) && fh >= Math.min(3, full.length) && fh > hit) { hit = fh; n = full.length; first = true; }
      }
      return [d, hit, n, first];
    })
      .filter(([, hit, n, first]) => first && (hit >= 2 || (n === 1 && hit === 1))).sort((a, b) => b[1] - a[1]);
    return scored.length && (scored.length === 1 || scored[0][1] > scored[1][1]) ? scored[0][0] : null;
  }

  /* ---------- حالة الطبيب الحين (نفس منطق صفحة الأطباء) ---------- */
  function nowR() {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date()).map(x => [x.type, x.value]));
    return { m: +p.hour * 60 + +p.minute, wd: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday], iso: `${p.year}-${p.month}-${p.day}` };
  }
  const hm = m => { const h = Math.floor(m / 60) % 24, mi = m % 60; return `${h % 12 || 12}${mi ? ":" + String(mi).padStart(2, "0") : ""}${h < 12 ? "ص" : "م"}`; };
  const shiftsFor = (d, wd) => d.alt?.days?.includes(wd) ? (d.alt.shifts || []) : (d.shifts || []);
  function active(d, t) {
    if ((d.workdays || []).includes(t.wd)) for (const s of shiftsFor(d, t.wd)) if (s.e > s.s ? (t.m >= s.s && t.m < s.e) : t.m >= s.s) return s;
    const y = (t.wd + 6) % 7; if ((d.workdays || []).includes(y)) for (const s of shiftsFor(d, y)) if (s.e <= s.s && t.m < s.e) return s;
    return null;
  }
  // «بعد ساعة و20 دقيقة»
  const left = mins => { mins = Math.max(1, Math.round(mins)); const h = Math.floor(mins / 60), m = mins % 60;
    const H = h === 1 ? "ساعة" : h === 2 ? "ساعتين" : h <= 10 ? `${h} ساعات` : `${h} ساعة`, M = m === 1 ? "دقيقة" : m === 2 ? "دقيقتين" : m <= 10 ? `${m} دقائق` : `${m} دقيقة`;
    return h && m ? `${H} و${M}` : h ? H : M; };
  const isoAdd = (iso, n) => { const x = new Date(iso + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  // أقرب بداية دوام (اليوم أو الأيام الجاية، ونتخطى أيام الإجازة)
  function nextStart(d, t) {
    for (let i = 0; i < 8; i++) {
      const wd = (t.wd + i) % 7, iso = isoAdd(t.iso, i);
      if (!(d.workdays || []).includes(wd)) continue;
      if ((board.vacations || []).some(v => v.doctorId === d.id && v.start <= iso && (!v.end || v.end >= iso))) continue;
      const st = shiftsFor(d, wd).map(x => x.s).filter(x => i > 0 || x > t.m).sort((a, b) => a - b)[0];
      if (st != null) return { day: i, wd, s: st, mins: i * 1440 + st - t.m };
    }
    return null;
  }
  function whenTxt(n) {
    if (!n) return "خارج الدوام";
    if (n.day === 0) return `دوامه يبدأ ${hm(n.s)} — بعد ${left(n.mins)}`;
    return `دوامه ${n.day === 1 ? "بكرة" : WD[n.wd]} ${hm(n.s)}`;
  }
  function status(d) {
    const t = nowR();
    const vac = (board.vacations || []).find(v => v.doctorId === d.id && v.start <= t.iso && (!v.end || v.end >= t.iso));
    if (vac) { const n = vac.end ? nextStart(d, t) : null; return ["vac", `في إجازة${vac.end ? " لين " + vac.end.split("-").reverse().slice(0, 2).join("/") : ""}${n && n.day > 0 ? " · يرجع " + (n.day === 1 ? "بكرة" : WD[n.wd]) + " " + hm(n.s) : ""}`]; }
    const s = today?.date === t.iso ? today.st?.[d.id] : null, a = active(d, t);
    if (s?.kind === "stop") return ["red", "⛔ وقف استقبال الحالات"];
    if (s?.kind === "absent") return ["red", "غير متواجد اليوم"];
    if (s?.kind === "appt") return ["amber", "مواعيد فقط"];
    if (s?.kind === "absent") return ["red", "غير متواجد اليوم"];
    if (s?.kind === "late" && t.m < s.from) return ["amber", `متأخر — يوصل ${hm(s.from)} (بعد ${left(s.from - t.m)})`];
    if (s?.kind === "busy") return ["amber", `زحمة${s.count ? " — " + s.count + " بالانتظار" : ""}`];
    if (s?.kind === "free" || s?.kind === "present") return ["green", "متواجد الحين"];
    if (a) { const endIn = (a.e > a.s ? a.e : a.e + (t.m >= a.s ? 1440 : 0)) - t.m; return ["green", `✓ متواجد الحين — لين ${hm(a.e)}${endIn <= 60 ? ` (باقي ${left(endIn)})` : ""}`]; }
    const n = nextStart(d, t);
    return [n && n.day === 0 && n.mins <= 60 ? "amber" : "gray", whenTxt(n)];
  }

  /* ---------- البطاقة جنب خانة الطبيب ---------- */
  function ensureBox() {
    if (host && document.documentElement.contains(host)) return;
    document.getElementById("saba-athir-doc")?.remove();
    host = document.createElement("div"); host.id = "saba-athir-doc";
    host.style.cssText = "all:initial;position:fixed;z-index:2147483646;display:none";
    const root = host.attachShadow({ mode: "open" });
    const CSS = `.b{direction:rtl;font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif;background:#fff;border:1px solid #DCEBF4;border-inline-start:5px solid #00A6E2;border-radius:12px;padding:7px 12px;box-shadow:0 8px 22px -12px rgba(0,55,101,.45);display:grid;gap:3px;min-width:220px;max-width:340px;text-align:right}
      .r1{display:flex;gap:8px;align-items:center;font-size:14px;font-weight:700;color:#003765;flex-wrap:wrap}
      .r1 span{background:#EAF6FC;border-radius:8px;padding:1px 8px}
      .r2{font-size:12.5px;font-weight:600}.green{color:#0A7A55}.red{color:#B4232A}.amber,.vac{color:#9A5B00}.gray{color:#5B7690}
      .no{font-size:12.5px;color:#5B7690}`;
    try { const sh = new CSSStyleSheet(); sh.replaceSync(CSS); root.adoptedStyleSheets = [sh]; root.innerHTML = '<div class="b"></div>'; } catch { root.innerHTML = `<style>${CSS}</style><div class="b"></div>`; }
    box = root.querySelector(".b");
    document.documentElement.append(host);
  }
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function place() {
    if (!host || host.style.display === "none" || !field) return;
    const vis = field.offsetParent ? field : (field.nextElementSibling?.classList?.contains("select2") || field.nextElementSibling?.className?.includes?.("chosen") ? field.nextElementSibling : field.parentElement);
    const r = (vis || field).getBoundingClientRect();
    if (!r.width) { host.style.display = "none"; return; }
    const w = host.offsetWidth || 260;
    host.style.top = Math.max(4, r.top + r.height / 2 - (host.offsetHeight || 50) / 2) + "px";
    host.style.left = Math.max(4, r.left - w - 12) + "px";               // يسار الخانة (الصفحة عربية)
  }

  // خانة الطبيب: select عنوانها «الطبيب» أو خياراتها «الاسم | التخصص»
  function findField() {
    const sels = [...document.querySelectorAll("select")];
    const byOpts = sels.filter(s => [...s.options].filter(o => /\|/.test(o.text)).length >= 2);
    return byOpts[0] || null;
  }
  function tick() {
    field = findField();
    if (!field) { if (host) host.style.display = "none"; return; }
    const o = field.options[field.selectedIndex], txt = o && o.value && !/اختر/.test(o.text) ? o.text.trim() : "";
    if (!txt) { if (host) host.style.display = "none"; lastSig = ""; return; }
    if (!board) { load(); return; }
    const t = nowR(), sig = txt + "|" + t.m + "|" + (today?.date || "") + (board?.updatedAt || "");
    if (sig !== lastSig) {
      lastSig = sig; ensureBox();
      const d = matchAthir(txt);
      if (!d) box.innerHTML = `<div class="no">د. ${esc(txt.split("|")[0].trim())} — مو موجود في جدول البوادي</div>`;
      else {
        const fl = board.floorNames?.[d.fl] || FLOOR_DEF[d.fl] || "الدور " + d.fl, [cls, st] = status(d);
        box.innerHTML = `<div class="r1"><span>${esc(fl)}</span>${d.room ? `<span>عيادة ${esc(d.room)}</span>` : ""}${d.ext ? `<span>☎ ${esc(d.ext)}</span>` : ""}</div><div class="r2 ${cls}">${esc(st)}</div>`;
      }
      host.style.display = "block";
    }
    place();
  }
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const iv = setInterval(() => { if (!alive()) { clearInterval(iv); return; } if (document.visibilityState === "visible") tick(); }, 500);       // select2 ما يطلق change عادي، فنراقب القيمة
  addEventListener("scroll", place, true); addEventListener("resize", place);
  setInterval(() => { if (field && document.visibilityState === "visible") load(); }, 60000);
})();
