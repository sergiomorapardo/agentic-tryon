// Local server for the agentic try-on: serves agentic.html and runs the Claude workflow with the keys from .env.
// Usage: npm start  (then open http://localhost:3000). Keys never reach the browser.
import http from "node:http";
import fs from "node:fs";
import { runTryOnWorkflow, sniffMediaType, GRAPH, MODEL, MAX_REVISIONS } from "./agent/workflow.mjs";

try { process.loadEnvFile(new URL("./.env", import.meta.url)); } catch { /* no .env: rely on the environment */ }
const PORT = Number(process.env.PORT || 3000);
const PAGE = new URL("./agentic.html", import.meta.url);
const MAX_BODY = 20 * 1024 * 1024;

// Test hook: IDM_MOCK=a.png,b.png makes generation return those files in order (the last one repeats) instead of
// calling the Space, so the UI and the evaluator loop can be tested end to end without spending ZeroGPU quota.
const MOCK = process.env.IDM_MOCK?.split(",").filter(Boolean);
const mockGenerate = MOCK && (() => { // one fresh sequence per request
  let i = 0;
  return async () => {
    const buffer = fs.readFileSync(MOCK[Math.min(i++, MOCK.length - 1)]);
    await new Promise((r) => setTimeout(r, 1500));
    return { buffer, mediaType: sniffMediaType(buffer), ms: 1500 };
  };
});

function decodeDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(dataUrl || "");
  if (!m) throw new Error("imagen inválida (se esperaba un data URL)");
  const buffer = Buffer.from(m[2], "base64");
  return { buffer, mediaType: sniffMediaType(buffer, m[1]) };
}
async function fetchImage(url) {
  if (!/^https?:\/\//i.test(url || "")) throw new Error("no hay prenda: falta la imagen o el enlace");
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`no se pudo descargar la prenda (HTTP ${r.status})`);
  const buffer = Buffer.from(await r.arrayBuffer());
  return { buffer, mediaType: sniffMediaType(buffer, r.headers.get("content-type")?.split(";")[0] || "image/jpeg") };
}
async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new Error("petición demasiado grande"); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function friendly(e) {
  const m = String(e?.message || e);
  if (e?.name === "QuotaError" || /ZeroGPU (quota|runs limit)/i.test(m)) {
    const wait = m.match(/Try again in ([\d:]+)/)?.[1];
    return { message: "Cuota gratuita de ZeroGPU agotada para esta IP" + (wait ? ` (se renueva en ${wait})` : "") + ".", hint: "Cambia de red (hotspot del móvil = IP nueva) o pon HF_TOKEN en .env." };
  }
  if (e?.status === 401) return { message: "La clave de Anthropic no es válida.", hint: "Revisa ANTHROPIC_API_KEY en .env y reinicia el servidor." };
  if (e?.status === 429) return { message: "Límite de peticiones de la API de Anthropic.", hint: "Espera unos segundos y reintenta." };
  return { message: m, hint: "" };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/agentic.html")) {
    if (!fs.existsSync(PAGE)) { res.writeHead(500).end("agentic.html no existe: ejecuta npm run build"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    fs.createReadStream(PAGE).pipe(res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: !!process.env.ANTHROPIC_API_KEY, model: MODEL, maxRevisions: MAX_REVISIONS }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/graph") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(GRAPH));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/tryon") {
    // Abort Claude and the GPU job if the browser cancels or closes the page.
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
    const emit = (e) => { if (!res.writableEnded) res.write(JSON.stringify(e) + "\n"); };
    const t0 = Date.now();
    try {
      const body = await readJson(req);
      const photo = decodeDataUrl(body.photo);
      const garment = body.garment ? decodeDataUrl(body.garment) : await fetchImage(body.garmentUrl);
      const out = await runTryOnWorkflow({ photo, garment, hint: String(body.hint || "").slice(0, 200) }, { emit, signal: ac.signal, ...(mockGenerate && { generate: mockGenerate() }) });
      console.log(`tryon ${out.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s · ${out.attempts.length} generation(s) · ${JSON.stringify(out.usage)}`);
    } catch (e) {
      if (ac.signal.aborted) { console.log("tryon cancelled by the client"); return; }
      console.error("tryon failed:", e);
      emit({ type: "error", ...friendly(e) });
    }
    res.end();
    return;
  }
  res.writeHead(404).end("not found");
});

if (!process.env.ANTHROPIC_API_KEY) console.warn("WARNING: ANTHROPIC_API_KEY is not set (.env)");
server.listen(PORT, "127.0.0.1", () => console.log(`Agentic try-on on http://localhost:${PORT} · model ${MODEL} · max revisions ${MAX_REVISIONS}${MOCK ? ` · IDM MOCK: ${MOCK.join(", ")}` : ""}`));
