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

  const output = await replicate.run("prunaai/p-image", {
    input: {
      prompt: fullPrompt,
      aspect_ratio: "custom",
      width: w,
      height: h,
      prompt_upsampling: true,
    },
  });

  console.log(`[Art] Generated in ${((Date.now() - start) / 1000).toFixed(2)}s`);
  return fetchToBuffer(output as unknown as string);
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

  const output = await replicate.run("black-forest-labs/flux-kontext-pro", {
    input: {
      prompt: artDescription,
      input_image: inputArt,
      aspect_ratio: aspectRatio,
    },
  });

  console.log(`[Art] Edited in ${((Date.now() - start) / 1000).toFixed(2)}s`);
  return fetchToBuffer(output as unknown as string);
}

async function fetchToBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  return Buffer.from(await response.arrayBuffer());
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
