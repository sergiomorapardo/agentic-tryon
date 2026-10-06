// Agentic try-on workflow. The structure is fixed in code (a workflow, not a free agent loop):
//   1. Parallelization (sectioning): Claude checks the photo and analyzes the garment at the same time.
//      Gate: stop before paying for an image if the photo is unusable or the garment does not fit the generator.
//   2. Evaluator-optimizer: the generator produces the image, Claude grades it against a rubric and proposes a
//      revision; the code regenerates at most MAX_REVISIONS times and returns the best attempt.
// Claude cannot output images, so generation goes to OpenAI (gpt-image-2, default) or IDM-VTON (GENERATOR=idm).
import "./env.mjs";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { generateTryOn, QuotaError } from "./idm.mjs";
import { generateOpenAI, OPENAI_IMAGE_MODEL } from "./openai.mjs";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
export const MAX_REVISIONS = Math.max(0, Number(process.env.MAX_REVISIONS ?? 1));
const PASS_SCORE = 4; // every rubric criterion must reach this (1-5) to pass
const PRICE = { input: 5 / 1e6, output: 25 / 1e6 }; // claude-opus-5, USD per token

// Image generators. `categories` drives the gate; `levers` tells the evaluator what a revision can change.
const GENERATORS = {
  openai: {
    label: OPENAI_IMAGE_MODEL, engine: "OpenAI", run: generateOpenAI,
    categories: ["upper_body", "lower_body", "dress"],
    initial: (analysis) => ({ description: analysis.description, category: analysis.category, instructions: "", quality: "medium" }),
    revise: (params, rev) => ({ ...params, description: rev.description, instructions: rev.instructions }),
    levers: "The generator is an instruction-following image editor (gpt-image). Levers: a sharper garment description and short corrective instructions (e.g. 'keep the original framing', 'collar must be light blue'). crop and steps are ignored.",
  },
  idm: {
    label: "IDM-VTON", engine: "IDM-VTON", run: generateTryOn,
    categories: ["upper_body"],
    initial: (analysis) => ({ description: analysis.description, crop: false, steps: 30, seed: 42 }),
    revise: (params, rev) => ({ description: rev.description, crop: rev.crop, steps: rev.steps, seed: params.seed + 1 }),
    levers: "The generator is IDM-VTON, a diffusion try-on model that only reads a short garment description. Levers: sharper description, auto-crop if the person is small in the frame, denoising steps (more = more detail). instructions are ignored.",
  },
};
export const GENERATOR_ID = process.env.GENERATOR || (process.env.OPENAI_API_KEY ? "openai" : "idm");
if (!GENERATORS[GENERATOR_ID]) throw new Error(`GENERATOR desconocido: ${GENERATOR_ID} (usa openai o idm)`);
export const GENERATOR = GENERATORS[GENERATOR_ID];

let client;
const anthropic = () => (client ??= new Anthropic());

// ---------- schemas ----------
const PhotoCheck = z.object({
  usable: z.boolean().describe("true if a virtual try-on can work on this photo"),
  visible_to: z.enum(["chest", "waist", "hips", "knees", "feet"]).describe("Lowest body part fully visible"),
  issues: z.array(z.string()).describe("Problems found, in Spanish, short. Empty if none."),
  tip: z.string().describe("One short instruction in Spanish for retaking the photo, or empty if usable"),
});
const GarmentAnalysis = z.object({
  category: z.enum(["upper_body", "lower_body", "dress", "not_a_garment"]),
  description: z.string().describe("English, under 20 words, completes 'model is wearing ...'. Colors, layout, sleeves, collar."),
  key_features: z.array(z.string()).describe("3-6 visual features in English the result must preserve"),
});
const Evaluation = z.object({
  garment_fidelity: z.number().int().min(1).max(5),
  identity_preserved: z.number().int().min(1).max(5),
  realism: z.number().int().min(1).max(5),
  failed_criteria: z.array(z.string()).describe("Spanish, one short line per criterion below 4"),
  feedback: z.string().describe("Spanish, one or two sentences for the user"),
  revision: z.object({
    description: z.string().describe("Improved English garment description for the next attempt"),
    instructions: z.string().describe("English, short corrective instructions for an instruction-following editor; empty if none"),
    crop: z.boolean().describe("true if the person is small in the frame and auto-crop would help"),
    steps: z.number().int().min(20).max(40),
  }),
});

// ---------- helpers ----------
const imageBlock = (img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.buffer.toString("base64") } });

export function sniffMediaType(buffer, fallback = "image/png") {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer.slice(8, 12).toString() === "WEBP") return "image/webp";
  return fallback;
}

function makeUsage() {
  const u = { calls: 0, input_tokens: 0, output_tokens: 0, images: { calls: 0, input_tokens: 0, output_tokens: 0 } };
  u.addImage = (usage) => { u.images.calls++; u.images.input_tokens += usage?.input_tokens || 0; u.images.output_tokens += usage?.output_tokens || 0; };
  u.add = (r) => { u.calls++; u.input_tokens += r.usage.input_tokens + (r.usage.cache_read_input_tokens || 0) + (r.usage.cache_creation_input_tokens || 0); u.output_tokens += r.usage.output_tokens; };
  u.summary = () => ({ calls: u.calls, input_tokens: u.input_tokens, output_tokens: u.output_tokens, usd: +(u.input_tokens * PRICE.input + u.output_tokens * PRICE.output).toFixed(4), images: { generator: GENERATOR.label, ...u.images } });
  return u;
}

async function ask({ schema, system, content, effort }, { signal, usage }) {
  const r = await anthropic().beta.messages.parse({
    model: MODEL, max_tokens: 4000, system,
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort, format: betaZodOutputFormat(schema) },
    messages: [{ role: "user", content }],
  }, { signal });
  usage.add(r);
  if (r.stop_reason === "refusal") throw new Error(`Claude declinó la solicitud (${r.stop_details?.category || "sin categoría"})`);
  if (!r.parsed_output) throw new Error(`Respuesta de Claude sin el formato esperado (stop_reason=${r.stop_reason})`);
  return r.parsed_output;
}

// ---------- steps ----------
const checkPhoto = (photo, ctx) => ask({
  effort: "low", schema: PhotoCheck,
  system: "You screen photos for a virtual try-on. It needs one person, facing the camera, head and torso visible at least down to the waist, reasonable light. Arms crossed over the chest, heavy occlusion, several people or no person make it fail. Report how far down the body is visible (lower-body garments need the legs). Be permissive with ordinary webcam quality.",
  content: [imageBlock(photo), { type: "text", text: "Can the try-on work on this photo?" }],
}, ctx);

const analyzeGarment = (garment, hint, ctx) => ask({
  effort: "low", schema: GarmentAnalysis,
  system: "You describe garment product photos for a virtual try-on model. The description goes into the prompt 'model is wearing <description>' and must be short, concrete and visual. Category: upper_body (shirts, jackets), lower_body (pants, skirts, shorts), dress (one-piece), not_a_garment.",
  content: [imageBlock(garment), { type: "text", text: hint ? `The user describes it as: "${hint}". Treat that as a hint, trust the image.` : "Describe this garment." }],
}, ctx);

const evaluate = (photo, garment, result, analysis, ctx) => ask({
  effort: "medium", schema: Evaluation,
  system: [
    "You grade virtual try-on results. Image 1 is the original person, image 2 the garment, image 3 the result.",
    "Rubric, each 1-5:",
    "- garment_fidelity: colors, color layout, collar, sleeve length and logos match image 2.",
    "- identity_preserved: face, hair, skin tone, body shape, pose and background match image 1.",
    "- realism: no artifacts on hands, arms, neck or garment edges; plausible fit and folds.",
    `A criterion below ${PASS_SCORE} fails. Be strict: a pass means you would show it to a customer.`,
    "Propose a revision for the next attempt that fixes what came out wrong.",
    GENERATOR.levers,
  ].join("\n"),
  content: [imageBlock(photo), imageBlock(garment), imageBlock(result),
    { type: "text", text: `Garment key features: ${analysis.key_features.join("; ")}. Grade the result.` }],
}, ctx);

// ---------- graph ----------
// Declared once; the server exposes it at /api/graph and the page draws it. The workflow emits "node" and "edge"
// events with these ids, so the trace shows what actually ran, not what the UI infers.
export const GRAPH = {
  nodes: [
    { id: "__start__", kind: "terminal", label: "START" },
    { id: "photo_check", kind: "llm", label: "photo_check", desc: "Claude revisa la foto" },
    { id: "garment_analysis", kind: "llm", label: "garment_analysis", desc: "Claude analiza la prenda" },
    { id: "gate", kind: "code", label: "gate", desc: "¿foto apta y prenda compatible?" },
    { id: "generate", kind: "tool", label: "generate", desc: `${GENERATOR.label} genera la imagen`, engine: GENERATOR.engine },
    { id: "evaluate", kind: "llm", label: "evaluate", desc: "Claude califica con la rúbrica" },
    { id: "decide", kind: "code", label: "decide", desc: "¿aprueba? ¿quedan revisiones?" },
    { id: "revise", kind: "code", label: "revise", desc: "aplica la revisión propuesta" },
    { id: "rejected", kind: "terminal", label: "END · rechazado" },
    { id: "__end__", kind: "terminal", label: "END · resultado" },
  ],
  edges: [
    { from: "__start__", to: "photo_check" },
    { from: "__start__", to: "garment_analysis" },
    { from: "photo_check", to: "gate" },
    { from: "garment_analysis", to: "gate" },
    { from: "gate", to: "generate", label: "apta" },
    { from: "gate", to: "rejected", label: "no apta" },
    { from: "generate", to: "evaluate" },
    { from: "generate", to: "__end__", label: "falla en revisión" },
    { from: "evaluate", to: "decide" },
    { from: "decide", to: "__end__", label: "aprobado / límite" },
    { from: "decide", to: "revise", label: "falla, quedan revisiones" },
    { from: "revise", to: "generate" },
  ],
};

// ---------- workflow ----------
// emit(event) receives progress events; returns the final summary (also emitted as {type: "result"}).
// Events: {type:"node", node, status, attempt?, ms?, data?, error?}, {type:"edge", from, to, label?},
// {type:"status", node, text}, {type:"result", ...}.
// generate is injectable so the loop can be tested without spending GPU quota.
export async function runTryOnWorkflow({ photo, garment, hint = "" }, { emit = () => {}, signal, generate = GENERATOR.run } = {}) {
  const usage = makeUsage();
  const ctx = { signal, usage };
  const t0 = Date.now();
  const desc = Object.fromEntries(GRAPH.nodes.map((n) => [n.id, n.desc]));
  const edge = (from, to, label) => emit({ type: "edge", from, to, ...(label && { label }) });
  const node = async (id, fn, attempt) => {
    const ts = Date.now();
    const base = { type: "node", node: id, label: desc[id] + (attempt ? ` (intento ${attempt})` : ""), ...(attempt && { attempt }) };
    emit({ ...base, status: "running" });
    try {
      const data = await fn();
      emit({ ...base, status: "done", ms: Date.now() - ts, data });
      return data;
    } catch (e) {
      emit({ ...base, status: "failed", ms: Date.now() - ts, error: e.message });
      throw e;
    }
  };

  // 1. Parallelization: two independent checks, both awaited before the gate decides.
  edge("__start__", "photo_check"); edge("__start__", "garment_analysis");
  const [photoCheck, analysis] = await Promise.all([
    node("photo_check", () => checkPhoto(photo, ctx)).finally(() => edge("photo_check", "gate")),
    node("garment_analysis", () => analyzeGarment(garment, hint, ctx)).finally(() => edge("garment_analysis", "gate")),
  ]);
  const gate = await node("gate", async () => {
    const reasons = [];
    if (!photoCheck.usable) reasons.push(`Foto no apta: ${photoCheck.issues.join("; ") || "sin detalle"}. ${photoCheck.tip}`.trim());
    if (!GENERATOR.categories.includes(analysis.category)) reasons.push(analysis.category === "not_a_garment" ? "La imagen de la prenda no muestra una prenda." : `La prenda es "${analysis.category}"; ${GENERATOR.label} solo viste: ${GENERATOR.categories.join(", ")}.`);
    else if (analysis.category !== "upper_body" && !["knees", "feet"].includes(photoCheck.visible_to)) reasons.push(`Para una prenda "${analysis.category}" la foto debe mostrar las piernas (se ve hasta: ${photoCheck.visible_to}). Aléjate de la cámara.`);
    return { pass: !reasons.length, reasons };
  });
  if (!gate.pass) {
    edge("gate", "rejected", "no apta");
    const out = { type: "result", status: "rejected", reasons: gate.reasons, photoCheck, analysis, attempts: [], usage: usage.summary(), ms: Date.now() - t0 };
    emit(out);
    return out;
  }
  edge("gate", "generate", "apta");

  // 2. Evaluator-optimizer: generate -> evaluate -> decide -> (revise -> generate), bounded by MAX_REVISIONS.
  const attempts = [];
  let params = GENERATOR.initial(analysis);
  let stopReason = "";
  for (let n = 1; n <= 1 + MAX_REVISIONS; n++) {
    let image;
    try {
      image = await node("generate", async () => {
        const r = await generate({ person: photo, garment, ...params }, { signal, onStatus: (text) => emit({ type: "status", node: "generate", text }) });
        usage.addImage(r.usage);
        return { ...r, mediaType: sniffMediaType(r.buffer, r.mediaType), toJSON: () => ({ ms: r.ms, kb: Math.round(r.buffer.length / 1024), params }) };
      }, n);
    } catch (e) {
      if (signal?.aborted || !attempts.length) throw e;
      stopReason = e instanceof QuotaError ? "cuota de ZeroGPU agotada antes de la revisión" : `la revisión falló: ${e.message}`; // keep the best attempt so far
      edge("generate", "__end__", "falla en revisión");
      break;
    }
    edge("generate", "evaluate");
    const grade = await node("evaluate", () => evaluate(photo, garment, image, analysis, ctx), n);
    edge("evaluate", "decide");
    const scores = { garment_fidelity: grade.garment_fidelity, identity_preserved: grade.identity_preserved, realism: grade.realism };
    const passed = Object.values(scores).every((s) => s >= PASS_SCORE);
    attempts.push({ n, params: { ...params }, scores, min: Math.min(...Object.values(scores)), passed, feedback: grade.feedback, failed_criteria: grade.failed_criteria, image });
    const decision = await node("decide", async () => {
      if (passed) return { next: "__end__", reason: "aprobado por la rúbrica" };
      if (n > MAX_REVISIONS) return { next: "__end__", reason: `máximo de revisiones (${MAX_REVISIONS}) sin aprobar` };
      return { next: "revise", reason: `criterio bajo ${PASS_SCORE}; revisión ${n} de ${MAX_REVISIONS}` };
    }, n);
    if (decision.next === "__end__") { stopReason = decision.reason; edge("decide", "__end__", "aprobado / límite"); break; }
    edge("decide", "revise", "falla, quedan revisiones");
    params = await node("revise", async () => GENERATOR.revise(params, grade.revision), n);
    edge("revise", "generate");
  }

  // Best attempt: highest minimum score, then highest total. A non-passing best keeps its failed criteria.
  const total = (a) => a.scores.garment_fidelity + a.scores.identity_preserved + a.scores.realism;
  const best = [...attempts].sort((a, b) => b.min - a.min || total(b) - total(a) || b.n - a.n)[0];
  const out = {
    type: "result", status: best.passed ? "passed" : "not_passed", stopReason, photoCheck, analysis,
    best: best.n, image: `data:${best.image.mediaType};base64,${best.image.buffer.toString("base64")}`,
    attempts: attempts.map(({ image, ...a }) => ({ ...a, gpu_ms: image.ms })),
    usage: usage.summary(), ms: Date.now() - t0,
  };
  emit(out);
  return out;
}
