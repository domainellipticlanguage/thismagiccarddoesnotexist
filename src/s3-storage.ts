import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({});

function bucketName(): string {
  return process.env.S3_BUCKET || "thismagiccarddoesnotexist3";
}

export async function uploadBuffer(
  buffer: Buffer,
  key: string,
  contentType = "image/png"
): Promise<string> {
  const start = Date.now();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  console.log(`[S3] put ${key} (${(buffer.length / 1024).toFixed(0)}kb) in ${((Date.now() - start) / 1000).toFixed(2)}s`);
  return getPublicUrl(key);
}

export async function uploadFromUrl(
  url: string,
  key: string
): Promise<string> {
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "image/png";
  return uploadBuffer(buffer, key, contentType);
}

/** Public URL for an S3 key. */
export function getPublicUrl(key: string): string {
  return `https://${bucketName()}.s3.amazonaws.com/${key}`;
}
