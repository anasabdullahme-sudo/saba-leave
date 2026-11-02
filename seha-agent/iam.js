// بوابة النفاذ (رابط دخول صحة iam.gov.sa/authservice/userauthservice): نشتغل حسب الرابط بس، بدون ما ننتظر شي ثاني.
// نكتب هويتك ونضغط «تسجيل الدخول» ونعيد لين يطلع رقم نفاذ → نرسل الرقم للبوت. يطلع شريط صغير فوق يقول وش نسوي.
(() => {
  if (window.top !== window) return;
  if (!/^https:\/\/(www\.)?iam\.gov\.sa\/(sso|authservice|nafath)/i.test(location.href)) return;   // نفاذ القديم (authservice) والجديد (sso)
  const { norm, visible, ownText, sleep } = A;

  // شريط حالة صغير (عشان تشوف إن الأداة شغالة)
  let bar = null;
  const show = t => {
    if (!bar) { bar = document.createElement("div"); bar.style.cssText = "position:fixed;top:8px;left:8px;z-index:2147483647;background:#003765;color:#fff;font:600 13px Tahoma,sans-serif;padding:6px 12px;border-radius:8px;direction:rtl;box-shadow:0 4px 14px rgba(0,0,0,.3)"; document.documentElement.append(bar); }
    bar.textContent = "أداة صحة: " + t;
  };
  chrome.runtime.onMessage.addListener((m, _s, reply) => { if (m.type === "STATE") reply({ page: "iam" }); return false; });
  const say = m => { try { return chrome.runtime.sendMessage(m).catch(() => null); } catch { return null; } };

  const inputs = () => [...document.querySelectorAll("input")].filter(i => visible(i) && !/^(hidden|password|checkbox|radio|submit|button)$/i.test(i.type));
  const idInput = () => {
    const all = inputs();
    return all.find(i => /id|national|user/i.test(i.name + " " + i.id) && !/pass/i.test(i.name + i.id))
      || all.find(i => /بطاقه|الاقامه|الهويه/.test(norm((i.closest("div,form,section")?.innerText || "") + " " + (i.placeholder || ""))))
      || all[0] || null;
  };
  const loginBtn = inp => {
    const form = inp?.closest("form");
    const cands = [...(form || document).querySelectorAll("button, input[type=submit], a, [role=button]")].filter(visible);
    return cands.find(el => /تسجيل الدخول|^دخول$|login|sign in/i.test(norm(el.textContent || el.value || ""))) || (form ? form.querySelector("button, input[type=submit]") : null);
  };
  // كتابة تشتغل مع أي إطار (Angular/React/عادي)
  function type(inp, v) {
    inp.focus();
    try { inp.select(); document.execCommand("insertText", false, v); } catch {}
    if (inp.value.replace(/\D/g, "") !== v) {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(inp, v);
    }
    ["input", "change", "keyup", "blur"].forEach(t => inp.dispatchEvent(new Event(t, { bubbles: true })));
  }
  const click = el => { const r = el.getBoundingClientRect(), o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach(t => el.dispatchEvent(new (t.startsWith("pointer") ? PointerEvent : MouseEvent)(t, o))); el.click(); };
  const numberEl = () => /اختيار الرقم|اختيار رقم|اختر الرقم|choose the number|select the number/i.test(norm(document.body.innerText))
    && [...document.querySelectorAll("body *")].find(el => visible(el) && /^\d{1,3}$/.test(ownText(el)) && el.childElementCount === 0);

  (async () => {
    await A.waitFor(() => document.body && document.body.innerText.length > 30, 20000);
    if (!/seha|صحه/i.test(norm(document.body.innerText) + location.href + document.referrer)) return;   // دخول صحة بس
    const c = await chrome.storage.local.get(["natId", "enabled"]);
    if (c.enabled === false) return;
    if (!/^[12]\d{9}$/.test(c.natId || "")) { show("ما فيه رقم هوية محفوظ — افتح إعدادات الأداة"); return; }
    show("تكتب الهوية…");
    const end = Date.now() + 3 * 60e3;
    let lastClick = 0, clicks = 0, sent = "";
    while (Date.now() < end) {
      const num = numberEl();
      if (num) { const n = ownText(num); if (n !== sent) { sent = n; show(`رقم نفاذ ${n} — انرسل لك واتساب`); await say({ type: "NAFATH_NUM", num: n }); } await sleep(3000); continue; }
      if (sent) { show("تم ✓"); return; }
      const inp = idInput();
      if (!inp) { show("أدوّر على خانة الهوية…"); await sleep(1000); continue; }
      if (inp.value.replace(/\D/g, "") !== c.natId) { type(inp, c.natId); await sleep(600); }
      const btn = loginBtn(inp);
      if (btn && (btn.disabled || btn.getAttribute("aria-disabled") === "true")) { inp.value = ""; type(inp, c.natId); show("كتبت الهوية — أنتظر زر الدخول يتفعّل"); await sleep(800); continue; }   // الزر مقفول لين تنكتب الهوية صح
      if (Date.now() - lastClick > 5000) {
        if (clicks >= 8) { show("ضغطت دخول 8 مرات وما طلع الرقم — جرّب بنفسك"); await say({ type: "IAM_ERR", err: "نفاذ ما طلع الرقم" }); return; }
        lastClick = Date.now(); clicks++;
        show(`كتبت الهوية — أضغط تسجيل الدخول (${clicks})`);
        if (btn) click(btn); else { const f = inp.closest("form"); if (f) { try { f.requestSubmit(); } catch { f.submit(); } } else inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true })); }
      }
      await sleep(1200);
    }
    if (!sent) { show("ما طلع رقم نفاذ"); await say({ type: "IAM_ERR", err: "ما طلع رقم نفاذ" }); }
  })();
})();
