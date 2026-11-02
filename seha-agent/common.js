// أدوات مشتركة لصفحات صحة ونفاذ (نفس طريقة أداة الموظفين: نلقى العناصر بنصها)
var A = (() => {
  const norm = s => String(s || "")
    .replace(/[ً-ْـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/[ىیئ]/g, "ي").replace(/ک/g, "ك").replace(/ؤ/g, "و").replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[*:：]/g, " ").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
  const T = s => String(s || "").replace(/\s+/g, " ").trim();
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const ownText = el => { let t = ""; for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent; return t.trim(); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(fn, ms = 10000, step = 250) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = fn(); if (v) return v; } catch {} await sleep(step); } return null; }
  // العناصر اللي نصها يساوي النص المطلوب (الأعمق فقط)
  const textEls = t => {
    const all = [...document.querySelectorAll("a, button, span, li, div, p, label, h1, h2, h3, h4, h5, strong, b")]
      .filter(el => el.childElementCount <= 2 && norm(el.textContent) === norm(t));
    return all.filter(el => !all.some(o => o !== el && el.contains(o)));
  };
  const clickable = el => el.closest("a, button, [role=button], [role=menuitem]") || el;
  const evAt = el => { const r = el.getBoundingClientRect(); return { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; };
  const realClick = el => { el = clickable(el); const o = evAt(el);
    [["pointerdown", PointerEvent], ["mousedown", MouseEvent], ["pointerup", PointerEvent], ["mouseup", MouseEvent], ["click", MouseEvent]].forEach(([t, C]) => el.dispatchEvent(new C(t, o))); };
  const hover = el => { for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) { const o = evAt(el);
    [["pointerover", PointerEvent], ["mouseover", MouseEvent], ["mousemove", MouseEvent]].forEach(([t, C]) => n.dispatchEvent(new C(t, o)));
    [["pointerenter", PointerEvent], ["mouseenter", MouseEvent]].forEach(([t, C]) => n.dispatchEvent(new C(t, { ...o, bubbles: false }))); } };
  function setValue(el, v) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    el.focus(); setter.call(el, v);
    ["input", "change", "keyup", "blur"].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
  }
  const TEXT_INPUT = "input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=button]):not([type=submit])";
  // خانة إدخال حسب عنوانها («رقم هوية / إقامة المريض …»)
  function inputByLabel(re) {
    const labels = [...document.querySelectorAll("label, span, div, p, small")]
      .filter(el => el.childElementCount === 0 && visible(el) && T(el.textContent).length < 70 && re.test(norm(el.textContent)));
    for (const l of labels) {
      if (l.htmlFor) { const i = document.getElementById(l.htmlFor); if (i && visible(i)) return i; }
      let p = l;
      for (let k = 0; k < 4 && p; k++) { p = p.parentElement; const ins = p ? [...p.querySelectorAll(TEXT_INPUT)].filter(visible) : []; if (ins.length === 1) return ins[0]; if (ins.length > 1) break; }
    }
    return null;
  }
  return { norm, T, visible, ownText, sleep, waitFor, textEls, clickable, realClick, hover, setValue, inputByLabel, TEXT_INPUT };
})();
