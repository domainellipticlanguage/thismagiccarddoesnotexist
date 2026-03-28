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
import { uploadBuffer } from "./s3-storage.js";

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

/** Render a full card and upload each face to S3. Returns public URLs. */
export async function renderAndUpload(cardData: CardData): Promise<{
  rendered: RenderedCard;
  renderedUrls: string[];
}> {
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

  return { rendered, renderedUrls: urls };
}

/** Build a RenderedCardDisplay from public URLs. */
export function buildDisplay(
  renderedUrls: string[],
  rendered?: RenderedCard
): RenderedCardDisplay | undefined {
  if (!renderedUrls.length || !renderedUrls[0]) return undefined;

  return {
    frontFace: renderedUrls[0],
    frontFaceOrientation: rendered?.frontFaceOrientation || "vertical",
    backFace: renderedUrls.length > 1 ? renderedUrls[1] : undefined,
    backFaceOrientation: renderedUrls.length > 1
      ? rendered?.backFaceOrientation || "vertical"
      : undefined,
    name: rendered?.normalizedCardData?.name || "",
    rotations: rendered?.rotations || [],
    scryfallJson: rendered?.scryfallJson || "",
    scryfallText: rendered?.scryfallText || "",
    crucibleText: rendered?.crucibleText || "",
  };
}
