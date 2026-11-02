// بوابة النفاذ الوطني: لو الأداة هي اللي بدأت الدخول (في تبويبها وخلال دقايق) → نكتب الهوية ونضغط «تسجيل الدخول»
// ونقرا الرقم اللي يطلع ونرسله للبوت (يوصلك واتساب، وتختاره من تطبيق نفاذ). غير كذا ما نسوي شي.
(() => {
  if (window.top !== window) return;
  const { norm, visible, ownText, sleep, waitFor, textEls, realClick, setValue, inputByLabel, TEXT_INPUT } = A;
  chrome.runtime.onMessage.addListener((m, _s, reply) => { if (m.type === "STATE") reply({ page: "iam" }); return false; });
  const numberEl = () => /اختيار الرقم/.test(norm(document.body.innerText))
    && [...document.querySelectorAll("body *")].find(el => visible(el) && /^\d{1,3}$/.test(ownText(el)) && el.childElementCount === 0);
  (async () => {
    const r = await chrome.runtime.sendMessage({ type: "IAM_HELLO" }).catch(() => null);
    if (!r?.go || !r.natId) return;
    let num = numberEl();
    if (!num) {
      const inp = await waitFor(() => inputByLabel(/بطاقه الاحوال|الاقامه|رقم الهويه/) || [...document.querySelectorAll(TEXT_INPUT)].find(visible), 15000);
      if (!inp) return chrome.runtime.sendMessage({ type: "IAM_ERR", err: "ما لقيت خانة الهوية في نفاذ" });
      setValue(inp, r.natId); await sleep(500);
      const btn = textEls("تسجيل الدخول").find(el => visible(el) && /^(BUTTON|A|INPUT)$/.test(A.clickable(el).tagName));
      if (!btn) return chrome.runtime.sendMessage({ type: "IAM_ERR", err: "ما لقيت زر تسجيل الدخول في نفاذ" });
      realClick(btn);
      num = await waitFor(numberEl, 25000);
    }
    if (num) chrome.runtime.sendMessage({ type: "NAFATH_NUM", num: ownText(num) });
    else chrome.runtime.sendMessage({ type: "IAM_ERR", err: "ما طلع رقم نفاذ" });
  })();
})();
