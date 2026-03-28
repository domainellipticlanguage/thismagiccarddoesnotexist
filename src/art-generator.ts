import Replicate from "replicate";
import { v4 as uuid } from "uuid";
import { uploadFromUrl, getPresignedUrl } from "./s3-storage.js";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export async function generateArt(
  artDescription: string,
  width: number,
  height: number
): Promise<string> {
  const fullPrompt =
    artDescription.replace(/\.$/, "") +
    ". In the style of high quality epic fantasy digital art";

  const aspectRatio = computeAspectRatio(width, height);

  console.log(`[Art] Generating (${aspectRatio}): ${fullPrompt.slice(0, 80)}...`);
  const start = Date.now();

  const output = await replicate.run("prunaai/p-image", {
    input: {
      prompt: fullPrompt,
      aspect_ratio: aspectRatio,
      prompt_upsampling: true,
    },
  });

  console.log(`[Art] Generated in ${((Date.now() - start) / 1000).toFixed(2)}s`);

  const tempUrl = output as unknown as string;
  const s3Key = `art/${uuid()}.png`;
  const s3Uri = await uploadFromUrl(tempUrl, s3Key);
  const signedUrl = await getPresignedUrl(s3Uri);
  console.log(`[Art] Uploaded: ${s3Key}`);
  return signedUrl;
}

export async function editArt(
  artDescription: string,
  originalArtUrl: string,
  width: number,
  height: number
): Promise<string> {
  console.log(`[Art] Editing: ${artDescription.slice(0, 80)}...`);
  const start = Date.now();

  const output = await replicate.run("black-forest-labs/flux-kontext-pro", {
    input: {
      prompt: artDescription,
      input_image: originalArtUrl,
    },
  });

  console.log(`[Art] Edited in ${((Date.now() - start) / 1000).toFixed(2)}s`);

  const tempUrl = output as unknown as string;
  const s3Key = `art/${uuid()}.png`;
  const s3Uri = await uploadFromUrl(tempUrl, s3Key);
  return getPresignedUrl(s3Uri);
}

function computeAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  if (ratio > 1.4) return "3:2";
  if (ratio > 1.1) return "4:3";
  if (ratio > 0.9) return "1:1";
  if (ratio > 0.7) return "3:4";
  return "2:3";
}
