// End-to-end test in headless Chrome with a fake camera, driven through the Chrome DevTools Protocol (no deps: Node >= 22 + Chrome).
// Usage: node src/e2e.mjs index.html photo.mjpeg [--skip-generate] [--deny-camera] [--order=leffa] [--garment-url=https://…]
//   photo.mjpeg = any half-body JPEG renamed to .mjpeg (Chrome plays it as the fake camera).
//   WIN=1280,720 forces the window size; OUT=/path changes where screenshots and the result go (default ./e2e-out).
import { spawn } from "node:child_process";
import fs from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const htmlPath = process.argv[2];
const mjpeg = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : null;
if (!htmlPath || !mjpeg) { console.error("usage: node e2e.mjs index.html photo.mjpeg [options]"); process.exit(1); }
const OUT = process.env.OUT || "./e2e-out"; fs.mkdirSync(OUT, { recursive: true });
const PROFILE = OUT + "/chrome-profile";
const skipGenerate = process.argv.includes("--skip-generate");
const denyCamera = process.argv.includes("--deny-camera");
const orderArg = (process.argv.find((a) => a.startsWith("--order=")) || "").slice(8);
const fileUrl = "file://" + (htmlPath.startsWith("/") ? htmlPath : process.cwd() + "/" + htmlPath);
fs.rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, ...(denyCamera ? [] : ["--use-fake-ui-for-media-stream"]), "--use-fake-device-for-media-stream",
  `--use-file-for-fake-video-capture=${mjpeg}`, `--window-size=${process.env.WIN || "1600,1000"}`, `--user-data-dir=${PROFILE}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

async function getTargets() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json`); return await r.json(); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error("Chrome no arrancó");
}
const targets = await getTargets();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled") console.log(`  [console.${m.params.type}]`, m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") console.log("  [EXCEPTION]", m.params.exceptionDetails.text, m.params.exceptionDetails.exception?.description || "");
  if (m.method === "Log.entryAdded" && m.params.entry.level !== "verbose") console.log(`  [browser.${m.params.entry.level}]`, m.params.entry.text, m.params.entry.url || "");
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${OUT}/shot-${name}.png`, Buffer.from(r.result.data, "base64")); };
const state = () => evalJs("window.__vton ? window.__vton.state : null").catch(() => null);
const text = (idSel) => evalJs(`document.getElementById(${JSON.stringify(idSel)}).textContent`);
async function waitState(states, timeoutMs) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const s = await state(); if (s !== last) { console.log(`  estado -> ${s} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); last = s; }
    if (states.includes(s)) return s;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout esperando ${states.join("|")}; estado=${last}`);
}
const dumpUi = async () => {
  console.log("status:", (await text("statusText")) + " | " + (await text("statusDetail")) + " | timer=" + (await text("timer")));
  console.log("error:", (await text("errorText")) + " " + (await text("errorHint")));
  console.log("botones visibles:", await evalJs("[...document.querySelectorAll('button')].filter(b=>!b.hidden).map(b=>b.id+(b.disabled?'(off)':'')).join(',')"));
  console.log("pills:", await evalJs("[...document.querySelectorAll('.pill')].map(p=>p.className+': '+p.textContent).join(' || ')"));
};

await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");
console.log("navegando a", fileUrl);
await send("Page.navigate", { url: fileUrl });
try {
  if (orderArg) { await new Promise((r) => setTimeout(r, 800)); await evalJs(`localStorage.setItem("vton.order", ${JSON.stringify(orderArg)})`); console.log("   orden forzado:", orderArg); }
  const cam = await waitState(["camera-ready", "camera-error"], 25000);
  console.log("1) cámara:", cam);
  await new Promise((r) => setTimeout(r, 1200));
  if (cam === "camera-error") { await shot("01-camera-error"); await dumpUi(); throw new Error("fin: prueba de cámara denegada"); }
  await shot("01-camera");
  console.log("   video:", await evalJs("(()=>{const v=document.getElementById('cam');return v.videoWidth+'x'+v.videoHeight+' readyState='+v.readyState})()"));
  const gUrl = (process.argv.find((a) => a.startsWith("--garment-url=")) || "").slice(14);
  if (gUrl) {
    await evalJs(`document.getElementById("garmentUrl").value = ${JSON.stringify(gUrl)}; document.getElementById("btnLoadGarment").click();`);
    const t0 = Date.now(); let info = null;
    while (Date.now() - t0 < 45000) {
      info = JSON.parse(await evalJs("JSON.stringify({source: window.__vton.garment.source, pending: !!window.__vton.garment.pending, blob: window.__vton.garment.blob ? window.__vton.garment.blob.size : null, url: window.__vton.garment.url, error: document.getElementById('errorText').textContent})"));
      if (!info.pending) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log(`   prenda (${((Date.now() - t0) / 1000).toFixed(1)} s):`, JSON.stringify(info));
    await shot("00-garment");
    if (info?.blob) fs.writeFileSync(`${OUT}/garment.jpg`, Buffer.from(await evalJs("window.__vton.garment.dataUrl.split(',')[1]"), "base64"));
  }
  await evalJs("document.getElementById('btnCapture').click()");
  console.log("2) captura:", await waitState(["captured"], 15000));
  await shot(`02-captured-${(process.env.WIN || "1600x1000").replace(",", "x")}`);
  console.log("   foto:", await evalJs("Math.round(window.__vton.photoBlob.size/1024)+' KB'"));
  fs.writeFileSync(`${OUT}/captured.jpg`, Buffer.from(await evalJs("window.__vton.photoDataUrl.split(',')[1]"), "base64"));
  if (!skipGenerate) {
    await evalJs("document.getElementById('btnGenerate').click()");
    const final = await waitState(["done", "error-gen"], 300000);
    console.log("3) final:", final);
    await new Promise((r) => setTimeout(r, 800));
    await shot("03-final");
    if (final === "done") {
      const rb = await evalJs("(async()=>{const u=new Uint8Array(await window.__vton.resultBlob.arrayBuffer());let s='';for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return btoa(s)})()");
      fs.writeFileSync(`${OUT}/result.png`, Buffer.from(rb, "base64"));
      console.log(`   resultado guardado en ${OUT}/result.png`);
    }
  }
  const ff = (process.argv.find((a) => a.startsWith("--test-fetchfast=")) || "").slice(17);
  if (ff) { const r = await evalJs(`(async()=>{const t=performance.now();const b=await window.__vton.fetchFast(${JSON.stringify(ff)}, {}, undefined);return b.size+" bytes "+b.type+" en "+((performance.now()-t)/1000).toFixed(1)+" s"})()`); console.log("fetchFast:", r); }
  await dumpUi();
  console.log("--- registro ---\n" + (await text("log")));
} catch (e) {
  console.log("FIN:", e.message);
  await shot("99-fin").catch(() => {});
  console.log("--- registro ---\n" + (await text("log").catch(() => "(sin registro)")));
}
ws.close(); chrome.kill();
