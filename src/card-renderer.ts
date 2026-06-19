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
import { composeDesigner } from "./designer-credit.js";

export { parseCard, formatCard, getArtDimensions, normalizeCard, toDisplayCard };
export type { CardData, RenderedCard, MtgCardDisplayData };

/** A throwaway copy of the card with the site credit appended to the designer,
 *  for the IMAGE only. The stored card keeps the bare designer. designer is a
 *  card-level field, so it's stamped on both faces. */
function withSiteCredit(cardData: CardData): CardData {
  const designer = composeDesigner(cardData.designer);
  const credited: CardData = { ...cardData, designer };
  if (cardData.linkedCard) credited.linkedCard = { ...cardData.linkedCard, designer };
  return credited;
}

/** Render `cardData` to image buffers with the implied site credit on the image,
 *  but keep `crucibleText` (the only text output carrying the designer) bare —
 *  so the site credit never lands in the stored record or the card text. */
async function renderWithCredit(
  cardData: CardData,
  quality: "medium" | "low",
): Promise<RenderedCard> {
  const rendered = await renderCard(withSiteCredit(cardData), { quality, format: "webp" });
  return { ...rendered, crucibleText: formatCard(cardData) };
}

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
  const rendered = await renderWithCredit(cardData, "medium");
  console.log(`[Render] Done in ${((Date.now() - start) / 1000).toFixed(2)}s`);
  return rendered;
}

/** Render a low-quality webp thumbnail (front + optional back) for the gallery. */
export async function renderThumbnailOnly(cardData: CardData): Promise<RenderedCard> {
  const start = Date.now();
  const rendered = await renderWithCredit(cardData, "low");
  console.log(`[Render] Thumbnail done in ${((Date.now() - start) / 1000).toFixed(2)}s`);
  return rendered;
}

/** Upload thumbnail face buffers to S3 in parallel. */
export async function uploadThumbnailFaces(rendered: RenderedCard): Promise<string[]> {
  const uploads: Promise<string>[] = [
    uploadBuffer(rendered.frontFace, `thumbnails/${uuid()}.webp`, "image/webp"),
  ];
  if (rendered.backFace) {
    uploads.push(uploadBuffer(rendered.backFace, `thumbnails/${uuid()}-back.webp`, "image/webp"));
  }
  return Promise.all(uploads);
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

/** Build a MtgCardDisplayData from stored data — no re-rendering needed.
 *  Pass `thumbnail: true` to source the (small) gallery thumbnail faces; it
 *  falls back to the full-resolution renderedUrls when no thumbnail exists. */
export function buildDisplay(
  doc: {
    renderedUrls: string[];
    thumbnailUrls?: string[];
    rotations: import("mtg-crucible").Rotation[];
    cardData: CardData;
    crucibleText: string;
    scryfallText: string;
    scryfallJson: string;
  },
  opts: { thumbnail?: boolean } = {},
): MtgCardDisplayData | undefined {
  const faces =
    opts.thumbnail && doc.thumbnailUrls?.length ? doc.thumbnailUrls : doc.renderedUrls;
  if (!faces.length || !faces[0]) return undefined;

  return {
    frontFaceImageUrl: faces[0],
    backFaceImageUrl: faces.length > 1 ? faces[1] : undefined,
    name: doc.cardData.name || "",
    rotations: doc.rotations,
    scryfallJson: doc.scryfallJson,
    scryfallText: doc.scryfallText,
    crucibleText: doc.crucibleText,
  };
}
