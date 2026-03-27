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
import { uploadBuffer, getPublicUrl } from "./s3-storage.js";

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
  renderedS3Uri: string;
  renderedUrl: string;
}> {
  console.log(`[Render] Rendering: ${cardData.name || "Untitled"}`);
  const start = Date.now();
  const rendered = await renderCard(cardData);
  console.log(`[Render] Done in ${((Date.now() - start) / 1000).toFixed(2)}s`);

  const s3Key = `rendered/${uuid()}.png`;
  const s3Uri = await uploadBuffer(rendered.frontFace, s3Key);
  const publicUrl = getPublicUrl(s3Uri);

  return { rendered, renderedS3Uri: s3Uri, renderedUrl: publicUrl };
}
