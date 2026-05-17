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

/** Render a card to image buffers. No S3 upload. */
export async function renderCardOnly(cardData: CardData): Promise<RenderedCard> {
  console.log(`[Render] Rendering: ${cardData.name || "Untitled"}`);
  const start = Date.now();
  const rendered = await renderCard(cardData, { quality: "medium", format: "webp" });
  console.log(`[Render] Done in ${((Date.now() - start) / 1000).toFixed(2)}s`);
  return rendered;
}

/** Upload front (and back, if present) face buffers to S3 in parallel. */
export async function uploadFaces(rendered: RenderedCard): Promise<string[]> {
  const uploads: Promise<string>[] = [
    uploadBuffer(rendered.frontFace, `rendered/${uuid()}.webp`, "image/webp"),
  ];
  if (rendered.backFace) {
    uploads.push(uploadBuffer(rendered.backFace, `rendered/${uuid()}-back.webp`, "image/webp"));
  }
  return Promise.all(uploads);
}

/** Build a MtgCardDisplayData from stored data — no re-rendering needed. */
export function buildDisplay(doc: {
  renderedUrls: string[];
  rotations: import("mtg-crucible").Rotation[];
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
