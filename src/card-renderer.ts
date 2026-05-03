import {
  parseCard,
  renderCard,
  formatCard,
  getArtDimensions,
  normalizeCard,
  toDisplayCard,
} from "mtg-crucible";
import type {
  CardData,
  RenderedCard,
  MtgCardDisplayData,
  Rotation,
} from "mtg-crucible";
import { v4 as uuid } from "uuid";
import { uploadBuffer } from "./s3-storage.js";

export { parseCard, formatCard, getArtDimensions, normalizeCard, toDisplayCard };
export type { CardData, RenderedCard, MtgCardDisplayData };

export function getArtDimensionsFromText(crucibleText: string): {
  width: number;
  height: number;
  cardData: CardData;
} {
  const cardData = parseCard(crucibleText);
  const dims = getArtDimensions(cardData);
  return { width: dims.primaryArtDimensions.width, height: dims.primaryArtDimensions.height, cardData };
}

export interface RenderResult {
  rendered: RenderedCard;
  renderedUrls: string[];
  rotations: Rotation[];
}

/** Render a card, upload faces to S3. */
export async function renderAndUpload(cardData: CardData): Promise<RenderResult> {
  console.log(`[Render] Rendering: ${cardData.name || "Untitled"}`);
  const start = Date.now();
  const rendered = await renderCard(cardData, { quality: "medium", format: "jpeg" });
  console.log(`[Render] Done in ${((Date.now() - start) / 1000).toFixed(2)}s`);

  const uploads: Promise<string>[] = [
    uploadBuffer(rendered.frontFace, `rendered/${uuid()}.jpg`, "image/jpeg"),
  ];
  if (rendered.backFace) {
    uploads.push(uploadBuffer(rendered.backFace, `rendered/${uuid()}-back.jpg`, "image/jpeg"));
  }
  const urls = await Promise.all(uploads);

  return {
    rendered,
    renderedUrls: urls,
    rotations: rendered.rotations,
  };
}

/** Build a MtgCardDisplayData from stored data — no re-rendering needed. */
export function buildDisplay(doc: {
  renderedUrls: string[];
  rotations: Rotation[];
  cardData: CardData;
  crucibleText: string;
  scryfallText: string;
  scryfallJson: string;
}): MtgCardDisplayData | undefined {
  if (!doc.renderedUrls.length || !doc.renderedUrls[0]) return undefined;

  return {
    frontFaceImageUrl: doc.renderedUrls[0],
    backFaceImageUrl: doc.renderedUrls.length > 1 ? doc.renderedUrls[1] : undefined,
    name: doc.cardData.name || "",
    rotations: doc.rotations,
    scryfallJson: doc.scryfallJson,
    scryfallText: doc.scryfallText,
    crucibleText: doc.crucibleText,
  };
}
