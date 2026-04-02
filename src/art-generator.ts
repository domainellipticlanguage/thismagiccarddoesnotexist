import Replicate from "replicate";
import { v4 as uuid } from "uuid";
import { uploadFromUrl } from "./s3-storage.js";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

/** Generate art, upload to S3, return public URL. */
export async function generateArt(
  artDescription: string,
  width: number,
  height: number
): Promise<string> {
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

  const tempUrl = output as unknown as string;
  const s3Key = `art/${uuid()}.png`;
  const publicUrl = await uploadFromUrl(tempUrl, s3Key);
  console.log(`[Art] Uploaded: ${s3Key}`);
  return publicUrl;
}

/** Edit existing art via Flux Kontext, upload to S3, return public URL. */
export async function editArt(
  artDescription: string,
  originalArtUrl: string,
  targetWidth?: number,
  targetHeight?: number,
): Promise<string> {
  const aspectRatio = (targetWidth && targetHeight)
    ? closestKontextRatio(targetWidth, targetHeight)
    : "match_input_image";

  console.log(`[Art] Editing (aspect ${aspectRatio}): ${artDescription.slice(0, 80)}...`);
  const start = Date.now();

  const output = await replicate.run("black-forest-labs/flux-kontext-pro", {
    input: {
      prompt: artDescription,
      input_image: originalArtUrl,
      aspect_ratio: aspectRatio,
    },
  });

  console.log(`[Art] Edited in ${((Date.now() - start) / 1000).toFixed(2)}s`);

  const tempUrl = output as unknown as string;
  const s3Key = `art/${uuid()}.png`;
  return uploadFromUrl(tempUrl, s3Key);
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

