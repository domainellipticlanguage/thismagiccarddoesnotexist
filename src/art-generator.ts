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

  console.log(`[Art] Generating (${width}x${height}): ${fullPrompt.slice(0, 80)}...`);
  const start = Date.now();

  const output = await replicate.run("prunaai/p-image", {
    input: {
      prompt: fullPrompt,
      aspect_ratio: "custom",
      width,
      height,
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

/** Edit existing art, upload to S3, return public URL. */
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
  return uploadFromUrl(tempUrl, s3Key);
}

