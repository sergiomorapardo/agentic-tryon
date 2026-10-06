// IDM-VTON on the public ZeroGPU Space, called from Node with @gradio/client (same signature the browser demo uses).
import { Client, handle_file } from "@gradio/client";

const SPACE = process.env.IDM_SPACE || "yisol/IDM-VTON";
const TIMEOUT_MS = Number(process.env.IDM_TIMEOUT_SEC || 180) * 1000;

let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    const opts = { events: ["status", "data"] };
    if (process.env.HF_TOKEN) opts.token = process.env.HF_TOKEN;
    clientPromise = Client.connect(SPACE, opts);
    clientPromise.catch(() => { clientPromise = null; });
  }
  return clientPromise;
}

export class QuotaError extends Error { name = "QuotaError"; }

// person/garment: { buffer, mediaType }. Returns { buffer, mediaType, ms }.
export async function generateTryOn({ person, garment, description, steps = 30, seed = 42, crop = false }, { signal, onStatus } = {}) {
  const t0 = Date.now();
  const client = await getClient();
  const blob = (img) => handle_file(new Blob([img.buffer], { type: img.mediaType }));
  // /tryon (Gradio 4.24): dict(ImageEditor), garm_img, garment_des, auto-mask, auto-crop, denoise_steps, seed
  const job = client.submit("/tryon", [
    { background: blob(person), layers: [], composite: null }, blob(garment), description, true, crop, steps, seed,
  ]);
  const cancel = () => { try { job.cancel(); } catch {} };
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, TIMEOUT_MS);
  let data = null;
  try {
    for await (const msg of job) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (msg.type === "status") {
        if (msg.stage === "error") {
          const m = msg.message || msg.title || "IDM-VTON error";
          throw /ZeroGPU (quota|runs limit)/i.test(m) ? new QuotaError(m) : new Error(m);
        }
        if (msg.stage === "pending") onStatus?.(msg.position > 0 ? `en cola, posición ${msg.position}` : "generando en GPU");
        if (msg.stage === "complete" && data) break;
      } else if (msg.type === "data" && msg.data) { data = msg.data; break; }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const file = data?.[0];
  const url = file?.url || (file?.path ? `${client.config.root}${client.api_prefix || ""}/file=${file.path}` : null);
  if (!url) throw new Error(Date.now() - t0 >= TIMEOUT_MS ? `IDM-VTON: tiempo agotado (${TIMEOUT_MS / 1000} s)` : "IDM-VTON no devolvió imagen");
  // The Space's /file= endpoint is slow (~25 KB/s measured): a ~600 KB PNG takes 20-50 s.
  onStatus?.("descargando resultado");
  const headers = process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {};
  const r = await fetch(url, { headers, signal });
  if (!r.ok) throw new Error(`No se pudo descargar el resultado (HTTP ${r.status})`);
  const buffer = Buffer.from(await r.arrayBuffer());
  return { buffer, mediaType: r.headers.get("content-type")?.split(";")[0] || "image/png", ms: Date.now() - t0 };
}
