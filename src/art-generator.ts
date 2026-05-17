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
 * Edit existing art via Flux Kontext. `inputArt` may be an existing URL
 * (e.g. an S3 URL from a stored card) or a Buffer (e.g. the just-generated
 * art for the other face); the Replicate SDK accepts both for file inputs.
 * Returns the edited image as a Buffer.
 */
export async function editArt(
  artDescription: string,
  inputArt: string | Buffer,
  targetWidth?: number,
  targetHeight?: number,
): Promise<Buffer> {
  const aspectRatio = (targetWidth && targetHeight)
    ? closestKontextRatio(targetWidth, targetHeight)
    : "match_input_image";

  console.log(`[Art] Editing (aspect ${aspectRatio}): ${artDescription.slice(0, 80)}...`);
  const start = Date.now();

  const input = {
    prompt: artDescription,
    input_image: inputArt,
    aspect_ratio: aspectRatio,
  };
  logReplicateRequest("black-forest-labs/flux-kontext-pro", input);
  const output = await replicate.run("black-forest-labs/flux-kontext-pro", { input });

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

const KONTEXT_RATIOS = [
  { label: "1:1",   ratio: 1 },
  { label: "16:9",  ratio: 16/9 },
  { label: "9:16",  ratio: 9/16 },
  { label: "4:3",   ratio: 4/3 },
  { label: "3:4",   ratio: 3/4 },
  { label: "3:2",   ratio: 3/2 },
  { label: "2:3",   ratio: 2/3 },
  { label: "4:5",   ratio: 4/5 },
  { label: "5:4",   ratio: 5/4 },
  { label: "21:9",  ratio: 21/9 },
  { label: "9:21",  ratio: 9/21 },
  { label: "2:1",   ratio: 2 },
  { label: "1:2",   ratio: 0.5 },
];

function closestKontextRatio(width: number, height: number): string {
  const target = width / height;
  let best = KONTEXT_RATIOS[0];
  let bestDiff = Math.abs(Math.log(target / best.ratio));
  for (const entry of KONTEXT_RATIOS) {
    const diff = Math.abs(Math.log(target / entry.ratio));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
    }
  }
  return best.label;
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
