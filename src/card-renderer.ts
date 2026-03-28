import {
  parseCard,
  renderCard,
  formatCard,
  getArtDimensions,
  toDisplayCard,
} from "@domainellipticlanguage/mtg-crucible";
import type {
  CardData,
  RenderedCard,
  RenderedCardDisplay,
} from "@domainellipticlanguage/mtg-crucible";
import { v4 as uuid } from "uuid";
import { uploadBuffer, getPresignedUrl } from "./s3-storage.js";

export { parseCard, formatCard, getArtDimensions, toDisplayCard };
export type { CardData, RenderedCard, RenderedCardDisplay };

export function getArtDimensionsFromText(crucibleText: string): {
  width: number;
  height: number;
  cardData: CardData;
} {
  const cardData = parseCard(crucibleText);
  const dims = getArtDimensions(cardData);
  return { width: dims.width, height: dims.height, cardData };
}

export async function renderAndUpload(cardData: CardData): Promise<{
  rendered: RenderedCard;
  frontS3Uri: string;
  backS3Uri?: string;
}> {
  console.log(`[Render] Rendering: ${cardData.name || "Untitled"}`);
  const start = Date.now();
  const rendered = await renderCard(cardData);
  console.log(`[Render] Done in ${((Date.now() - start) / 1000).toFixed(2)}s`);

  const frontKey = `rendered/${uuid()}.png`;
  const frontS3Uri = await uploadBuffer(rendered.frontFace, frontKey);

  let backS3Uri: string | undefined;
  if (rendered.backFace) {
    const backKey = `rendered/${uuid()}-back.png`;
    backS3Uri = await uploadBuffer(rendered.backFace, backKey);
  }

  return { rendered, frontS3Uri, backS3Uri };
}

/** Build a RenderedCardDisplay with presigned S3 URLs (call at serve time, not persist time). */
export async function buildDisplay(record: {
  frontS3Uri?: string;
  backS3Uri?: string;
  crucibleText: string;
  scryfallText: string;
  cardData: CardData;
}): Promise<RenderedCardDisplay | undefined> {
  if (!record.frontS3Uri) return undefined;
  const frontFace = await getPresignedUrl(record.frontS3Uri);
  const backFace = record.backS3Uri ? await getPresignedUrl(record.backS3Uri) : undefined;

  return {
    frontFace,
    frontFaceOrientation: "vertical",
    backFace,
    backFaceOrientation: backFace ? "vertical" : undefined,
    name: record.cardData.name || "",
    rotations: [],
    scryfallJson: "",
    scryfallText: record.scryfallText,
    crucibleText: record.crucibleText,
  };
}
