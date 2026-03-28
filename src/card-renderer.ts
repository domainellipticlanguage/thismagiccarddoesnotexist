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
  MtgCardDisplayData,
  Rotation,
} from "@domainellipticlanguage/mtg-crucible";
import { v4 as uuid } from "uuid";
import { uploadBuffer } from "./s3-storage.js";

export { parseCard, formatCard, getArtDimensions, toDisplayCard };
export type { CardData, RenderedCard, MtgCardDisplayData };

export function getArtDimensionsFromText(crucibleText: string): {
  width: number;
  height: number;
  cardData: CardData;
} {
  const cardData = parseCard(crucibleText);
  const dims = getArtDimensions(cardData);
  return { width: dims.width, height: dims.height, cardData };
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
  const rendered = await renderCard(cardData);
  console.log(`[Render] Done in ${((Date.now() - start) / 1000).toFixed(2)}s`);

  const urls: string[] = [];

  const frontKey = `rendered/${uuid()}.png`;
  urls.push(await uploadBuffer(rendered.frontFace, frontKey));

  if (rendered.backFace) {
    const backKey = `rendered/${uuid()}-back.png`;
    urls.push(await uploadBuffer(rendered.backFace, backKey));
  }

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
