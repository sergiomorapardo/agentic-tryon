// Assembles ../index.html from template.html + the Gradio client + the garment.
// Usage: node build.mjs   (only needed to regenerate the HTML; the final HTML depends on nothing)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, f));

let bundle = read("gradio-client-2.6.0.min.js").toString("utf8");

// The bundle is an ES module; turn its trailing `export { a as B, ... }` into a global assignment.
const m = bundle.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
if (!m) throw new Error("Trailing export statement not found in the bundle");
const pairs = m[1]
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [local, , exported] = s.split(/\s+/);
    return `${exported || local}: ${local}`;
  });
bundle = bundle.slice(0, m.index) + `\nwindow.__gradio = { ${pairs.join(", ")} };\n`;
if (/<\/script/i.test(bundle)) bundle = bundle.replace(/<\/script/gi, "<\\/script");

const garmentB64 = read("garment.jpg").toString("base64");
const garmentDataUrl = `data:image/jpeg;base64,${garmentB64}`;

let html = read("template.html").toString("utf8");
const replaceOnce = (needle, value) => {
  if (!html.includes(needle)) throw new Error(`Missing placeholder: ${needle}`);
  html = html.split(needle).join(value);
};
replaceOnce("/*__GRADIO_CLIENT__*/", bundle);
replaceOnce("__GARMENT_DATA_URL__", garmentDataUrl);

const out = path.join(here, "..", "index.html");
fs.writeFileSync(out, html);
console.log(`OK -> ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
