// CLI for the workflow, no browser: node agent/run.mjs person.jpg garment.jpg ["hint"] [--out=result.png]
import fs from "node:fs";
import { runTryOnWorkflow, sniffMediaType, MODEL, MAX_REVISIONS } from "./workflow.mjs";

try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch {}
const [personPath, garmentPath, hint = ""] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const outPath = (process.argv.find((a) => a.startsWith("--out=")) || "--out=e2e-out/agent-result.png").slice(6);
if (!personPath || !garmentPath) { console.error("usage: node agent/run.mjs person.jpg garment.jpg [hint] [--out=file]"); process.exit(1); }
const load = (p) => { const buffer = fs.readFileSync(p); return { buffer, mediaType: sniffMediaType(buffer, "image/jpeg") }; };

console.log(`model=${MODEL} max_revisions=${MAX_REVISIONS}`);
const t0 = Date.now();
const emit = (e) => {
  const t = ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
  if (e.type === "step") console.log(`${t}s  [${e.status}] ${e.label}${e.ms != null ? ` (${(e.ms / 1000).toFixed(1)} s)` : ""}${e.data ? " " + JSON.stringify(e.data) : ""}${e.error ? " ERROR " + e.error : ""}`);
  else if (e.type === "status") console.log(`${t}s    · ${e.text}`);
  else if (e.type === "revision") console.log(`${t}s  revision -> ${JSON.stringify(e.params)}`);
};
const out = await runTryOnWorkflow({ photo: load(personPath), garment: load(garmentPath), hint }, { emit });
const { image, ...summary } = out;
console.log(JSON.stringify(summary, null, 2));
if (image) {
  fs.mkdirSync(outPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(image.split(",")[1], "base64"));
  console.log(`result -> ${outPath}`);
}
