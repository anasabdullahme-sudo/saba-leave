// بوابة النفاذ الوطني (دخول صحة): نكتب هويتك ونضغط «تسجيل الدخول»، ونعيد المحاولة لين يطلع رقم نفاذ،
// بعدها نرسل الرقم للبوت (يوصلك واتساب). ما نوقف لين ننتقل للصفحة الثانية (الرقم) أو تمر 3 دقايق.
(() => {
  if (window.top !== window) return;
  const { norm, visible, ownText, sleep, waitFor, textEls, realClick, setValue, inputByLabel, TEXT_INPUT } = A;
  chrome.runtime.onMessage.addListener((m, _s, reply) => { if (m.type === "STATE") reply({ page: "iam" }); return false; });
  const numberEl = () => /اختيار الرقم|اختر الرقم/.test(norm(document.body.innerText))
    && [...document.querySelectorAll("body *")].find(el => visible(el) && /^\d{1,3}$/.test(ownText(el)) && el.childElementCount === 0);
  const idInput = () => { const i = inputByLabel(/بطاقه الاحوال|الاقامه|رقم الهويه/) || [...document.querySelectorAll(TEXT_INPUT)].find(visible); return i && visible(i) ? i : null; };
  const loginBtn = () => textEls("تسجيل الدخول").find(el => visible(el) && /^(BUTTON|A|INPUT)$/.test(A.clickable(el).tagName))
    || [...document.querySelectorAll("button, input[type=submit]")].find(el => visible(el) && /تسجيل الدخول/.test(norm(el.textContent || el.value)));
  const say = m => chrome.runtime.sendMessage(m).catch(() => null);

  (async () => {
    await waitFor(() => document.body && document.body.innerText.length > 50, 20000);
    const seha = /seha/i.test(document.body.innerText) || /seha\.sa/i.test(document.referrer) || /seha/i.test(location.href);   // دخول صحة بس
    let r = null;
    for (let i = 0; i < 5 && !r; i++) { r = await say({ type: "IAM_HELLO", seha }); if (!r) await sleep(1500); }   // الخلفية ممكن نايمة
    if (!r?.go || !r.natId) return;
    const end = Date.now() + 3 * 60e3;
    let lastClick = 0, clicks = 0, sent = "";
    while (Date.now() < end) {
      const num = numberEl();
      if (num) { const n = ownText(num); if (n !== sent) { sent = n; await say({ type: "NAFATH_NUM", num: n }); } await sleep(3000); continue; }   // الرقم يتغير لو انتهى وانطلب من جديد
      if (sent) return;                                                              // الرقم راح = وافقت وانتقلنا
      const inp = idInput();
      if (inp) {
        if (inp.value.replace(/\D/g, "") !== r.natId) { setValue(inp, r.natId); await sleep(500); }
        const btn = loginBtn();
        if (btn && Date.now() - lastClick > 5000) {                                  // ما انتقل؟ نضغط مرة ثانية
          if (clicks >= 6) { await say({ type: "IAM_ERR", err: "ضغطت دخول نفاذ 6 مرات وما طلع الرقم" }); return; }
          lastClick = Date.now(); clicks++; realClick(btn);
        }
      }
      await sleep(1200);
    }
    if (!sent) await say({ type: "IAM_ERR", err: "ما طلع رقم نفاذ" });
  })();
})();
