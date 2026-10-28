// صورة تقرير الطلب المفتوح في صحة (من لوحة سابا) — تكبير وتدوير
let rot = 0;
const m = document.getElementById("m");
chrome.storage.local.get(["sabaReqImg", "sabaReq"], ({ sabaReqImg: x, sabaReq: r }) => {
  if (!x || (r && r.id !== x.id)) return;
  if (r?.patientName) document.getElementById("t").textContent = "صورة التقرير — " + r.patientName;
  m.textContent = "";
  if (x.pdf) {
    let src = x.url;
    if (src.startsWith("data:")) { const [h, b] = src.split(","); const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); src = URL.createObjectURL(new Blob([u], { type: "application/pdf" })); }
    const f = document.createElement("iframe"); f.src = src; m.append(f);
    document.getElementById("rot").hidden = document.getElementById("zm").hidden = true;
  } else {
    const im = document.createElement("img"); im.src = x.url; im.alt = "صورة التقرير"; m.append(im);
    const zoom = () => m.classList.toggle("zoom");
    im.onclick = zoom; document.getElementById("zm").onclick = zoom;
    document.getElementById("rot").onclick = () => { rot = (rot + 90) % 360; im.style.transform = `rotate(${rot}deg)`; };
  }
});
