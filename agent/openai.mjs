// Try-on with OpenAI's image edits endpoint: person + garment in, edited person out. Plain fetch, no SDK dependency.
// gpt-image-2 rejects input_fidelity (verified 2026-10-05); identity is kept through the prompt instead.
export const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_SEC || 180) * 1000;

const AREA = {
  upper_body: "replacing only their current top",
  lower_body: "replacing only their current pants or skirt",
  dress: "replacing their current outfit with this one-piece garment",
};

export function buildPrompt({ description, category = "upper_body", instructions = "" }) {
  return [
    "Virtual try-on. Image 1 is a photo of a person. Image 2 is a product photo of a garment.",
    `Dress the person from image 1 in the garment from image 2 (${description}), ${AREA[category] || AREA.upper_body}.`,
    "Keep the person's face, hair, skin tone, body shape, pose, the rest of their clothes, the framing and the background exactly as in image 1.",
    "Reproduce the garment exactly: colors, color layout, collar, buttons, logos, sleeve length and fit. Natural folds, realistic lighting matching image 1.",
    instructions && `Corrections from the previous attempt: ${instructions}`,
  ].filter(Boolean).join(" ");
}

// person/garment: { buffer, mediaType }. Returns { buffer, mediaType, ms, usage }.
export async function generateOpenAI({ person, garment, description, category, instructions, quality = "medium" }, { signal, onStatus } = {}) {
  const t0 = Date.now();
  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  const ext = (img) => img.mediaType.split("/")[1].replace("jpeg", "jpg");
  form.append("image[]", new Blob([person.buffer], { type: person.mediaType }), `person.${ext(person)}`);
  form.append("image[]", new Blob([garment.buffer], { type: garment.mediaType }), `garment.${ext(garment)}`);
  form.append("prompt", buildPrompt({ description, category, instructions }));
  form.append("size", "1024x1536");
  form.append("quality", quality);
  onStatus?.(`generando con ${OPENAI_IMAGE_MODEL} (calidad ${quality})`);
  const r = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST", body: form, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = new Error(`OpenAI (${OPENAI_IMAGE_MODEL}): ${j.error?.message || `HTTP ${r.status}`}`);
    e.status = r.status; e.code = j.error?.code;
    throw e;
  }
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error(`OpenAI (${OPENAI_IMAGE_MODEL}) no devolvió imagen`);
  return { buffer: Buffer.from(b64, "base64"), mediaType: `image/${j.output_format || "png"}`, ms: Date.now() - t0, usage: j.usage };
}
