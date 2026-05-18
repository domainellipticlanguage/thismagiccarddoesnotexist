import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

/**
 * Generate art via Replicate. Returns the image bytes as a Buffer (no S3
 * upload here — `persistGeneratedCard` uploads in the background).
 */
export async function generateArt(
  artDescription: string,
  width: number,
  height: number
): Promise<Buffer> {
  const fullPrompt =
    artDescription.replace(/\.$/, "") +
    ". In the style of high quality epic fantasy digital art";

  const { w, h } = fitDimensions(width, height, 256, 1440);
  console.log(`[Art] Generating (${w}x${h}): ${fullPrompt.slice(0, 80)}...`);
  const start = Date.now();

  const input = {
    prompt: fullPrompt,
    aspect_ratio: "custom",
    width: w,
    height: h,
    prompt_upsampling: false,
  };
  logReplicateRequest("prunaai/p-image", input);
  const output = await replicate.run("prunaai/p-image", { input });

  const url = toOutputUrl(output);
  console.log(`[Art] Generated in ${((Date.now() - start) / 1000).toFixed(2)}s → ${url}`);
  return fetchToBuffer(url);
}

/**
 * Edit existing art via Pruna's p-image-edit. `inputArt` may be an existing
 * URL (e.g. an S3 URL from a stored card) or a Buffer (e.g. the just-generated
 * art for the other face); the Replicate SDK accepts both for file inputs.
 * Returns the edited image as a Buffer. Always preserves the source image's
 * aspect — p-image-edit is for fine-grained edits, not reframing, and the
 * model's accepted ratio set is narrower than the card-frame aspects we'd
 * want to target anyway.
 */
export async function editArt(
  artDescription: string,
  inputArt: string | Buffer,
): Promise<Buffer> {
  console.log(`[Art] Editing: ${artDescription.slice(0, 80)}...`);
  const start = Date.now();

  const input = {
    prompt: artDescription,
    images: [inputArt],
    aspect_ratio: "match_input_image",
  };
  logReplicateRequest("prunaai/p-image-edit", input);
  const output = await replicate.run("prunaai/p-image-edit", { input });

  const url = toOutputUrl(output);
  console.log(`[Art] Edited in ${((Date.now() - start) / 1000).toFixed(2)}s → ${url}`);
  return fetchToBuffer(url);
}

/** Log a Replicate request, summarizing Buffer/Blob inputs as `<Buffer Nkb>` so
 *  we don't dump megabytes of binary into the terminal. */
function logReplicateRequest(model: string, input: Record<string, unknown>): void {
  const summarize = (v: unknown): unknown => {
    if (Buffer.isBuffer(v)) return `<Buffer ${(v.length / 1024).toFixed(0)}kb>`;
    if (Array.isArray(v)) return v.map(summarize);
    return v;
  };
  const summarized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) summarized[k] = summarize(v);
  console.log(`[Art] → replicate.run(${model}, ${JSON.stringify(summarized)})`);
}

/** Replicate's SDK returns either a raw URL string or a FileOutput object with
 *  a `.url()` method depending on the model version. Normalize to a string. */
function toOutputUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  if (output && typeof (output as { url?: () => URL | string }).url === "function") {
    return (output as { url(): URL | string }).url().toString();
  }
  throw new Error(`Unexpected Replicate output shape: ${typeof output}`);
}

async function fetchToBuffer(url: string): Promise<Buffer> {
  const start = Date.now();
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  console.log(`[Art] Fetched ${(buffer.length / 1024).toFixed(0)}kb in ${((Date.now() - start) / 1000).toFixed(2)}s`);
  return buffer;
}

/** Scale dimensions to fit within [min, max] while preserving aspect ratio. */
function fitDimensions(
  width: number,
  height: number,
  min: number,
  max: number
): { w: number; h: number } {
  const scale = Math.min(max / Math.max(width, height), Math.max(min / Math.min(width, height), 1));
  return {
    w: Math.round(width * scale),
    h: Math.round(height * scale),
  };
}
