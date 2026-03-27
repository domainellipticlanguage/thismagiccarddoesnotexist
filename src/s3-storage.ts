import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});

function bucketName(): string {
  return process.env.S3_BUCKET || "thismagiccarddoesnotexist3";
}

export async function uploadBuffer(
  buffer: Buffer,
  key: string,
  contentType = "image/png"
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return `s3://${bucketName()}/${key}`;
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

export function getPublicUrl(s3Uri: string): string {
  const match = s3Uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) return s3Uri;
  return `https://${match[1]}.s3.amazonaws.com/${match[2]}`;
}

export async function getPresignedUrl(
  s3Uri: string,
  expiresIn = 3600
): Promise<string> {
  const match = s3Uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) return s3Uri;
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: match[1], Key: match[2] }),
    { expiresIn }
  );
}
