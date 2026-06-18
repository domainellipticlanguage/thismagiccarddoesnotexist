import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export const ART_MODEL = "black-forest-labs/flux-2-klein-4b";

/** Short artist credit shown on the card — the model name without the owner. */
export const ART_CREDIT = ART_MODEL.split("/").pop()!; // "flux-2-klein-4b"

/** Output resolution in megapixels. FLUX.2 klein accepts "0.25", "0.5", "1", "2", "4"
 *  and wants it as a string. */
function getMegapixels(): string {
  return process.env.ART_MEGAPIXELS ?? "1";
}

/** FLUX.2 klein only accepts a fixed set of aspect ratios; snap to the nearest
 *  in log space so 4:3 vs 3:2 (each 1.33x off 1:1) are equidistant. */
const ASPECT_RATIOS: { name: string; ratio: number }[] = [
  { name: "21:9", ratio: 21 / 9 },
  { name: "16:9", ratio: 16 / 9 },
  { name: "3:2",  ratio: 3 / 2 },
  { name: "4:3",  ratio: 4 / 3 },
  { name: "5:4",  ratio: 5 / 4 },
  { name: "1:1",  ratio: 1 },
  { name: "4:5",  ratio: 4 / 5 },
  { name: "3:4",  ratio: 3 / 4 },
  { name: "2:3",  ratio: 2 / 3 },
  { name: "9:16", ratio: 9 / 16 },
  { name: "9:21", ratio: 9 / 21 },
];

function pickAspectRatio(width: number, height: number): string {
  const target = width / height;
  let best = ASPECT_RATIOS[0];
  let bestDist = Math.abs(Math.log(target / best.ratio));
  for (const ar of ASPECT_RATIOS) {
    const dist = Math.abs(Math.log(target / ar.ratio));
    if (dist < bestDist) { best = ar; bestDist = dist; }
  }
  return best.name;
}

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

  const aspect_ratio = pickAspectRatio(width, height);
  const output_megapixels = getMegapixels();
  console.log(`[Art] Generating (${aspect_ratio} @ ${output_megapixels}MP): ${fullPrompt.slice(0, 80)}...`);
  const start = Date.now();

  const input = {
    prompt: fullPrompt,
    aspect_ratio,
    output_megapixels,
  };
  logReplicateRequest(ART_MODEL, input);
  const output = await replicate.run(ART_MODEL, { input });

  const url = toOutputUrl(output);
  console.log(`[Art] Generated in ${((Date.now() - start) / 1000).toFixed(2)}s → ${url}`);
  return fetchToBuffer(url);
}

/**
 * Edit existing art via the same FLUX.2 klein model — it accepts up to five
 * reference images via the `images` param and uses `match_input_image` to
 * preserve the source aspect.
 * `inputArt` may be a URL (e.g. an existing S3 URL) or a Buffer (e.g. the
 * just-generated art for the other face); the Replicate SDK accepts both.
 */
export async function editArt(
  artDescription: string,
  inputArt: string | Buffer,
): Promise<Buffer> {
  const output_megapixels = getMegapixels();
  console.log(`[Art] Editing @ ${output_megapixels}MP: ${artDescription.slice(0, 80)}...`);
  const start = Date.now();

  const input = {
    prompt: artDescription,
    images: [inputArt],
    aspect_ratio: "match_input_image",
    output_megapixels,
  };
  logReplicateRequest(ART_MODEL, input);
  const output = await replicate.run(ART_MODEL, { input });

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

/** Replicate's SDK returns either a raw URL string, an array of strings, a
 *  FileOutput object with `.url()`, or an array of those. Normalize to a string. */
function toOutputUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const first = output[0];
    if (typeof first === "string") return first;
    if (first && typeof (first as { url?: () => URL | string }).url === "function") {
      return (first as { url(): URL | string }).url().toString();
    }
  }
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
